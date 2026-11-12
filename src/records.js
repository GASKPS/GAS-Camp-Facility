import { Upload } from 'tus-js-client';
import { daysInPeriod } from './dates.js';
import { legacyLeaveRequest } from './leave.js';

const bucket = 'selaras-sumber';
const table = 'attendance_checks';
const monthTable = 'attendance_months';
const leaveTable = 'attendance_leave_forms';
const teamBucket = 'validasi-absensi-tim';
const teamTable = 'attendance_team_checks';
const teamMonthTable = 'attendance_team_months';
const kinds = ['finger', 'roster', 'absensi'];
const recordFields = 'id,period,scan_start,scan_end,source_files,completed_at,totals';
const replacedMessage = 'Periode ini sudah diperbarui. Buka hasil terbaru di Riwayat.';
const rosterConflict = 'Roster periode ini sudah tersimpan. Muat ulang periode lalu periksa lagi.';
const chunkSize = 6 * 1024 * 1024;
const types = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

function unwrap(response) {
  if (response.error) throw response.error;
  return response.data;
}

function uploadLargeFile(client, projectUrl, owner, bucketName, path, file, type, signal) {
  const endpoint = new URL('/storage/v1/upload/resumable', projectUrl);
  endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      signal.removeEventListener('abort', cancel);
      callback(value);
    };
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      chunkSize,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      metadata: { bucketName, objectName: path, contentType: type, cacheControl: '0' },
      onBeforeRequest: async request => {
        signal.throwIfAborted();
        const { session } = unwrap(await client.auth.getSession());
        if (session?.user.id !== owner) throw new Error('Sesi telah berubah.');
        request.setHeader('Authorization', `Bearer ${session.access_token}`);
      },
      onSuccess: () => finish(resolve),
      onError: error => finish(reject, error),
    });
    const cancel = () => {
      void upload.abort().catch(() => {});
      finish(reject, signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    upload.start();
  });
}

async function removeReplacedSources(client, storage, owner, period, rosterId, signal) {
  // Storage menerima maksimal 1.000 jalur per permintaan penghapusan.
  const batchSize = 300;
  let after;
  for (;;) {
    const query = client.from(table).select('id').eq('owner_id', owner).eq('period', period)
      .eq('status', 'replaced').order('id').limit(batchSize);
    if (after) query.gt('id', after);
    const rows = unwrap(await query.abortSignal(signal));
    signal.throwIfAborted();
    if (rows.length) {
      const paths = rows.flatMap(({ id }) => kinds.filter(kind => id !== rosterId || kind !== 'roster')
        .map(kind => `${owner}/${id}/${kind}`));
      unwrap(await storage.remove(paths));
    }
    if (rows.length < batchSize) return;
    after = rows.at(-1).id;
  }
}

export async function saveCheck(client, { projectUrl, owner, teamId, id, files, result, storedRoster, signal, onUpload }) {
  const bucketName = teamId ? teamBucket : bucket;
  const checks = teamId ? teamTable : table;
  const storage = client.storage.from(bucketName);
  const prefix = `${teamId || owner}/${id}`;
  const usedKinds = kinds.filter(kind => files[kind] || (kind === 'roster' && storedRoster));
  const cleanUp = () => teamId ? Promise.resolve() : removeReplacedSources(client, storage, owner, result.period, storedRoster?.id ?? id, signal).catch(() => {});
  const sourceFiles = Object.fromEntries(usedKinds.map(kind => {
    if (kind === 'roster' && storedRoster) return [kind, storedRoster.file];
    const { name, size } = files[kind];
    return [kind, { name, size, type: types[name.split('.').at(-1).toLowerCase()] }];
  }));
  const { error } = await client.from(checks).insert({
    id, period: result.period, scan_start: result.start, scan_end: result.end, source_files: sourceFiles,
    ...(teamId ? { team_id: teamId } : {}),
    ...(storedRoster ? { roster_id: storedRoster.id } : {}),
  }).abortSignal(signal);
  signal.throwIfAborted();

  const uploaded = new Set();
  if (error?.code === '23505') {
    const existing = unwrap(await client.from(checks).select('status,completed_at,source_files').eq('id', id).abortSignal(signal).single());
    if (existing.status === 'replaced') throw new Error(replacedMessage);
    if (existing.completed_at) {
      await cleanUp();
      return { id, completed_at: existing.completed_at, source_files: existing.source_files };
    }
    const objects = unwrap(await storage.list(prefix, { limit: kinds.length }, { signal }));
    for (const object of objects) uploaded.add(object.name);
  } else if (error) {
    throw error;
  }

  for (const kind of usedKinds) {
    signal.throwIfAborted();
    if (uploaded.has(kind) || (kind === 'roster' && storedRoster)) continue;
    const file = files[kind];
    const contentType = sourceFiles[kind].type;
    const path = `${prefix}/${kind}`;
    onUpload(kind);
    if (file.size >= chunkSize) {
      await uploadLargeFile(client, projectUrl, owner, bucketName, path, file, contentType, signal);
    } else {
      unwrap(await storage.upload(path, file.slice(0, file.size, contentType), { contentType, cacheControl: '0' }));
    }
  }

  signal.throwIfAborted();
  onUpload(null);
  const completedAt = unwrap(await client.rpc(teamId ? 'attendance_complete_team_check' : 'complete_attendance_check', {
    ...(teamId ? { p_id: id } : { p_check_id: id }), p_result: result,
  }).abortSignal(signal));
  await cleanUp();
  return { id, completed_at: completedAt, source_files: sourceFiles };
}

const pageSize = 15;

export async function listChecks(client, cursor, signal, knownPeriods = []) {
  const seen = new Set(knownPeriods);
  const rows = [];
  let hasMore = true;
  while (rows.length < pageSize && hasMore) {
    const query = client.from(table).select(recordFields).eq('status', 'ready')
      .order('completed_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
    if (cursor) {
      const { completed_at: time, id } = cursor;
      query.or(`completed_at.lt.${time},and(completed_at.eq.${time},id.lt.${id})`);
    }
    const page = unwrap(await query.abortSignal(signal));
    let consumed = 0;
    for (const row of page) {
      cursor = row;
      consumed++;
      if (seen.has(row.period)) continue;
      seen.add(row.period);
      rows.push(row);
      if (rows.length === pageSize) break;
    }
    hasMore = consumed < page.length || page.length > pageSize;
  }
  return { rows, hasMore, cursor };
}

export async function readCheck(client, period, signal) {
  return unwrap(await client.from(table).select(`${recordFields},result`)
    .eq('status', 'ready').eq('period', period)
    .order('completed_at', { ascending: false }).order('id', { ascending: false }).limit(1)
    .abortSignal(signal).single());
}

export async function readMonthlyArchive(client, period, signal, teamId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const query = client.from(teamId ? teamMonthTable : monthTable).select('period,roster_id,roster_file,roster_rows,coverage,updated_at').eq('period', period);
    if (teamId) query.eq('team_id', teamId);
    const response = await query.abortSignal(signal).maybeSingle();
    if (['42P01', 'PGRST205'].includes(response.error?.code)) return { available: false, month: null, batches: [] };
    const month = unwrap(response);
    if (!month) return { available: true, month: null, batches: [] };
    const ids = [...new Set(Object.values(month.coverage))];
    if (!ids.length) return { available: true, month, batches: [] };
    const batchQuery = client.from(teamId ? teamTable : table).select(`${recordFields},result`)
      .eq('status', 'ready').in('id', ids).order('completed_at', { ascending: false });
    if (teamId) batchQuery.eq('team_id', teamId);
    const batches = unwrap(await batchQuery.abortSignal(signal));
    if (batches.length === ids.length) return { available: true, month, batches };
  }
  throw new Error('Arsip sedang diperbarui. Muat ulang periode.');
}

export async function listMonths(client, cursor, signal, teamId) {
  const query = client.from(teamId ? teamMonthTable : monthTable).select('period,coverage,updated_at')
    .order('period', { ascending: false }).limit(pageSize + 1);
  if (teamId) query.eq('team_id', teamId);
  if (cursor) query.lt('period', cursor);
  const page = unwrap(await query.abortSignal(signal));
  const rows = page.slice(0, pageSize);
  return { rows, hasMore: page.length > pageSize, cursor: rows.at(-1)?.period ?? cursor };
}

const leaveFields = 'id,nik,kind,start_date,end_date,collected';
const permissionTable = 'attendance_permissions';
const permissionFields = 'id,nik,code,permit_date,approved';

export async function listLeaveForms(client, period, signal) {
  const days = daysInPeriod(period);
  const forms = [];
  const limit = 200;
  let cursor;
  for (;;) {
    const query = client.from(leaveTable).select(leaveFields).lte('start_date', days.at(-1).key)
      .gte('end_date', days[0].key).order('id').limit(limit);
    if (cursor) query.gt('id', cursor);
    const page = unwrap(await query.abortSignal(signal));
    forms.push(...page);
    if (page.length < limit) break;
    cursor = page.at(-1).id;
  }
  return forms.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.nik.localeCompare(b.nik));
}

export async function saveLeaveForm(client, entry, id, signal) {
  const table = client.from(leaveTable);
  const query = id ? table.update(entry).eq('id', id) : table.insert(entry);
  return unwrap(await query.select(leaveFields).abortSignal(signal).single());
}

export async function removeLeaveForm(client, id, signal) {
  return unwrap(await client.from(leaveTable).delete().eq('id', id).abortSignal(signal));
}

async function extrasPages(query, signal) {
  const rows = [];
  const size = 200;
  for (let offset = 0; ; offset += size) {
    const response = await query().order('id').range(offset, offset + size - 1).abortSignal(signal);
    if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(response.error?.code)) return null;
    const page = unwrap(response);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export async function listAttendanceExtras(client, period, signal, teamId) {
  const days = daysInPeriod(period);
  const start = days[0].key;
  const end = days.at(-1).key;
  const [requests, permissions] = await Promise.all([
    extrasPages(() => client.rpc(teamId ? 'attendance_list_team_leave' : 'list_attendance_leave_requests', {
      ...(teamId ? { p_team: teamId } : {}), p_start: start, p_end: end,
    }, { get: true }), signal),
    extrasPages(() => {
      const query = client.from(teamId ? 'attendance_team_permissions' : permissionTable).select(permissionFields)
        .gte('permit_date', start).lte('permit_date', end);
      return teamId ? query.eq('team_id', teamId) : query;
    }, signal),
  ]);
  if (!requests || !permissions) {
    if (teamId) throw new Error('Siapkan database Sub Departemen untuk membuka Form Cuti.');
    const legacy = await listLeaveForms(client, period, signal);
    return { leaveRequests: legacy.map(legacyLeaveRequest), permissions: null };
  }
  requests.sort((a, b) => a.segments[0].start_date.localeCompare(b.segments[0].start_date) || a.nik.localeCompare(b.nik));
  permissions.sort((a, b) => a.permit_date.localeCompare(b.permit_date) || a.nik.localeCompare(b.nik));
  return { leaveRequests: requests, permissions };
}

export async function saveLeaveRequests(client, requests, deleteId, signal, teamId) {
  return unwrap(await client.rpc(teamId ? 'attendance_save_team_leave' : 'save_attendance_leave_requests', {
    ...(teamId ? { p_team: teamId } : {}),
    p_requests: requests, p_delete_id: deleteId ?? null,
  }).abortSignal(signal));
}

export async function savePermission(client, entry, id, signal, teamId) {
  const table = client.from(teamId ? 'attendance_team_permissions' : permissionTable);
  const query = id ? table.update(entry).eq('id', id) : table.insert(teamId ? { ...entry, team_id: teamId } : entry);
  if (id && teamId) query.eq('team_id', teamId);
  return unwrap(await query.select(permissionFields).abortSignal(signal).single());
}

export async function removePermission(client, id, signal, teamId) {
  const query = client.from(teamId ? 'attendance_team_permissions' : permissionTable).delete().eq('id', id);
  if (teamId) query.eq('team_id', teamId);
  return unwrap(await query.abortSignal(signal));
}

export async function downloadSource(client, scopeId, id, kind, signal, team = false) {
  return unwrap(await client.storage.from(team ? teamBucket : bucket).download(`${scopeId}/${id}/${kind}`, {}, { signal, cache: 'no-store' }));
}

export function storageError(error, fallback) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.originalResponse?.getStatus());
  const message = `${error?.message ?? ''} ${error?.originalResponse?.getBody() ?? ''}`;
  if ([replacedMessage, rosterConflict].includes(error?.message)) return error.message;
  if (['42P01', 'PGRST202', 'PGRST205'].includes(error?.code) || /bucket not found|schema cache/i.test(message)) {
    return 'Aktifkan penyimpanan dengan menjalankan supabase/setup.sql di SQL Editor proyek Supabase.';
  }
  if (status === 413 || /maximum allowed size|file size limit|entity too large|payload too large/i.test(message)) {
    return 'Ukuran unggahan melebihi batas proyek Supabase. Periksa batas ukuran di pengaturan Storage.';
  }
  if ([401, 403].includes(status) || error?.code === '42501' || /row.level security/i.test(message)) {
    return 'Akses penyimpanan ditolak. Periksa sesi login dan jalankan supabase/setup.sql di proyek yang sama.';
  }
  return fallback;
}
