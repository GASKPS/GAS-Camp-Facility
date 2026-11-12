import '@fontsource-variable/dm-sans';
import './styles.css';
import { createAuthClient, initialProject, saveProject, validateProject } from './auth.js';
import { currentPeriod, daysInPeriod, formatDate, validCoverage, validDate } from './dates.js';
import { isPermissionCode, normalizeCode } from './audit.js';
import { makeDemo } from './demo.js';
import { downloadSource, listAttendanceExtras, listMonths, readMonthlyArchive, removePermission, saveCheck, saveLeaveRequests, savePermission, storageError } from './records.js';
import { applyGrades, checkLeaveForms, coverageText, mergeMonthlyResult } from './monthly.js';
import { leaveOrder, leaveRequest, leaveSegments, legacyLeaveRequest } from './leave.js';
import { sourceNames } from './labels.js';
import { calendarContent, dashboardView, detailView, employeeCalendarView, filesDialog, historyDialog, leavePage, loginView, projectDialog, sources } from './views.js';
import { applyManualReviews, applyOffCycle, reviewBasis } from './off-cycle.js';
import { listTeamActivity, manageAccount, periodOffset, readManagement, readTeamSettings, readWorkspace, saveDayReview, saveDepartment, saveGrade, saveTeam, setTeamAccess } from './workspace.js';
import { confirmationView, managementView, workspaceEmpty, workspaceFrame } from './workspace-views.js';


const root = document.querySelector('#app');
const maxFileSize = 64 * 1024 * 1024;
const state = {
  user: null, demo: false, config: null, fixedConfig: false, authBusy: false, authError: '', email: '',
  period: '', start: '', end: '', files: {}, result: null, search: '', warningFilter: '', busy: false, progress: '', error: '',
  pendingSave: null, saving: false, downloading: '',
  monthStatus: 'idle', month: null, batches: [], monthError: '', notice: '', baseResult: null,
  leaveRequests: null, permissions: null, leaveError: '',
  workspaceStatus: 'idle', workspaceError: '', profile: null, departments: [], teams: [], team: null, departmentName: '',
  retentionPeriod: '', latestPeriod: '', showUpload: false, grades: {}, reviews: [], previousResults: [], checkLeave: true, mutating: false,
};
let auth = null;
let authListener = null;
let authGeneration = 0;
let worker = null;
let auditGeneration = 0;
let accountScope = new AbortController();
let saveRequest = null;
let history = null;
let monthGeneration = 0;
let leaveEditor = null;
let teamScope = new AbortController();
let workspaceGeneration = 0;
let management = null;
let pendingConfirmation = null;

const canManage = () => ['administrator', 'department_admin'].includes(state.profile?.role);

function render() {
  if (!state.user && !state.demo) {
    root.innerHTML = loginView(state);
    return;
  }
  let content;
  if (state.workspaceStatus !== 'ready') content = workspaceEmpty(state);
  else if (location.hash === '#kelola' && canManage() && management) content = managementView(state, management);
  else if (!state.team) content = workspaceEmpty(state);
  else if (location.hash === '#form-cuti') {
    leaveEditor ??= { tab: 'leave', entry: null, busy: false, error: '', notice: '' };
    content = leavePage(state, leaveEditor);
  } else content = dashboardView(state);
  const scroll = root.querySelector('.table-scroll');
  const offset = scroll && state.result ? [scroll.scrollLeft, scroll.scrollTop] : null;
  root.innerHTML = workspaceFrame(state, content);
  const newScroll = root.querySelector('.table-scroll');
  if (offset && newScroll) [newScroll.scrollLeft, newScroll.scrollTop] = offset;
}

function applyAttendanceExtras() {
  if (!state.baseResult) {
    state.result = null;
    return;
  }
  const result = applyGrades(state.baseResult, state.grades);
  const forms = state.checkLeave && state.leaveRequests ? leaveSegments(state.leaveRequests) : null;
  const checked = checkLeaveForms(result, forms, state.permissions);
  const previous = state.previousResults.map(prior => applyGrades(prior, state.grades));
  state.result = applyManualReviews(applyOffCycle([...previous, checked], state.reviews).at(-1), state.reviews);
}

function cancelAudit() {
  auditGeneration++;
  worker?.terminate();
  worker = null;
  state.busy = false;
  state.progress = '';
}

function resetAudit(period = currentPeriod()) {
  cancelAudit();
  monthGeneration++;
  leaveEditor = null;
  saveRequest?.abort();
  saveRequest = null;
  state.period = period;
  state.start = daysInPeriod(period)[0]?.key ?? '';
  state.end = '';
  state.files = {};
  state.result = null;
  state.error = '';
  state.search = '';
  state.warningFilter = '';
  state.pendingSave = null;
  state.saving = false;
  state.downloading = '';
  Object.assign(state, { monthStatus: 'idle', month: null, batches: [], monthError: '', notice: '', baseResult: null,
    leaveRequests: null, permissions: null, leaveError: '', grades: {}, reviews: [], previousResults: [] });
}

function setUser(user) {
  const changed = state.user?.id !== user?.id;
  if (changed) {
    accountScope.abort();
    teamScope.abort();
    accountScope = new AbortController();
    teamScope = new AbortController();
    workspaceGeneration++;
    history = null;
    management = null;
    pendingConfirmation = null;
    resetAudit();
    Object.assign(state, { team: null, teams: [], departments: [], profile: null, workspaceStatus: 'idle',
      workspaceError: '', latestPeriod: '', mutating: false });
  }
  state.user = user;
  state.demo = false;
  state.authError = '';
  if (changed && !user) calendarRoute();
  render();
  if (changed && user) void refreshWorkspace();
}

function leavePreferenceKey(teamId) {
  return `validasi-form-cuti:${state.user?.id ?? 'demo'}:${teamId}`;
}

function readLeavePreference(teamId) {
  try { return localStorage.getItem(leavePreferenceKey(teamId)) !== 'off'; } catch { return true; }
}

function calendarRoute() {
  if (location.hash) location.hash = '';
}

async function openTeam(id, navigate = true) {
  const team = state.teams.find(row => row.id === id);
  if (!team) return;
  if (team.id === state.team?.id && state.monthStatus === 'ready' && navigate) {
    if (state.latestPeriod !== state.period) {
      resetAudit(state.latestPeriod);
      state.showUpload = false;
      void refreshMonth();
    }
    calendarRoute();
    render();
    return;
  }
  teamScope.abort();
  teamScope = new AbortController();
  const signal = teamScope.signal;
  resetAudit();
  history = null;
  state.team = team;
  state.departmentName = state.departments.find(row => row.id === team.department_id)?.name || '';
  state.checkLeave = readLeavePreference(team.id);
  state.latestPeriod = '';
  state.showUpload = false;
  state.monthStatus = 'loading';
  if (navigate) calendarRoute();
  render();
  try {
    const { rows } = await listMonths(auth, null, signal, team.id);
    if (signal.aborted) return;
    state.latestPeriod = rows[0]?.period ?? currentPeriod();
    resetAudit(state.latestPeriod);
    state.showUpload = !rows.length && team.editable;
    await refreshMonth();
  } catch (error) {
    if (signal.aborted) return;
    state.monthStatus = 'error';
    state.monthError = storageError(error, 'Kalender Sub Departemen gagal dimuat. Coba lagi.');
    render();
  }
}

async function refreshWorkspace(keepView = false) {
  if (!state.user) return;
  const generation = ++workspaceGeneration;
  const signal = accountScope.signal;
  if (!keepView) {
    state.workspaceStatus = 'loading';
    render();
  }
  try {
    const workspace = await readWorkspace(auth, signal);
    if (signal.aborted || generation !== workspaceGeneration) return;
    state.profile = workspace?.profile ?? null;
    state.departments = workspace?.departments ?? [];
    state.teams = workspace?.teams ?? [];
    state.retentionPeriod = workspace?.retention_period ?? '';
    state.workspaceStatus = !workspace ? 'setup' : !state.profile ? 'unassigned' : !state.profile.active ? 'inactive' : 'ready';
    const selected = state.teams.find(row => row.id === state.team?.id);
    if (state.workspaceStatus !== 'ready' || (!selected && !state.teams.length)) {
      teamScope.abort();
      resetAudit();
      state.team = null;
    } else if (selected && keepView) {
      state.team = selected;
      state.departmentName = state.departments.find(row => row.id === selected.department_id)?.name || '';
    } else {
      await openTeam(selected?.id ?? state.teams[0].id, false);
    }
    if (location.hash === '#kelola' && canManage() && !management) void openManagement();
  } catch {
    if (signal.aborted || generation !== workspaceGeneration) return;
    state.workspaceStatus = 'error';
    state.workspaceError = 'Akses Sub Departemen gagal diperiksa. Muat ulang akses.';
  }
  if (!signal.aborted && generation === workspaceGeneration) render();
}

async function refreshMonth() {
  if (!state.user || !state.team || !daysInPeriod(state.period).length) return;
  const generation = ++monthGeneration;
  const period = state.period;
  const teamId = state.team.id;
  const signal = teamScope.signal;
  const client = auth;
  state.monthStatus = 'loading';
  state.monthError = '';
  render();
  try {
    const periods = [periodOffset(period, -2), periodOffset(period, -1), period].filter(item => item >= state.retentionPeriod);
    const [archives, extras, settings] = await Promise.all([
      Promise.all(periods.map(item => readMonthlyArchive(client, item, signal, teamId))),
      readAttendanceExtras(client, period, signal, teamId),
      readTeamSettings(client, teamId, periods[0] ?? period, period, signal),
    ]);
    if (signal.aborted || generation !== monthGeneration) return;
    const last = archives.at(-1);
    if (!last?.available) throw new Error('Database Sub Departemen belum tersedia.');
    const baseResult = last.month ? mergeMonthlyResult(last.month, last.batches) : null;
    const previousResults = archives.slice(0, -1).filter(row => row.month).map(row => mergeMonthlyResult(row.month, row.batches));
    Object.assign(state, { monthStatus: 'ready', month: last.month, batches: last.batches, baseResult, previousResults, ...extras, ...settings });
    applyAttendanceExtras();
  } catch (error) {
    if (signal.aborted || generation !== monthGeneration) return;
    state.monthStatus = 'error';
    state.monthError = storageError(error, 'Arsip Sub Departemen gagal dimuat. Muat ulang periode.');
  } finally {
    if (!signal.aborted && generation === monthGeneration) render();
  }
}

async function readAttendanceExtras(client, period, signal, teamId) {
  try {
    return { ...await listAttendanceExtras(client, period, signal, teamId), leaveError: '' };
  } catch {
    return { leaveRequests: null, permissions: null, leaveError: 'Form Cuti dan izin gagal dimuat. Muat ulang periode.' };
  }
}

async function connectProject(config) {
  const generation = ++authGeneration;
  authListener?.unsubscribe();
  authListener = null;
  state.config = config;
  auth = config ? createAuthClient(config) : null;
  if (!auth) {
    render();
    return;
  }
  const client = auth;
  state.authBusy = true;
  render();
  const listener = client.auth.onAuthStateChange(event => {
    if (generation === authGeneration && event === 'SIGNED_OUT' && state.user) setUser(null);
  });
  authListener = listener.data.subscription;
  try {
    const { data: { session }, error } = await client.auth.getSession();
    if (error) throw error;
    if (session) {
      const { data, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (generation === authGeneration && data.user && !state.demo) setUser(data.user);
    }
  } catch {
    if (generation === authGeneration) state.authError = 'Sesi Supabase perlu diperiksa. Coba masuk kembali.';
  } finally {
    if (generation === authGeneration) {
      state.authBusy = false;
      render();
    }
  }
}

function loginError(error) {
  if (error?.code === 'invalid_credentials') return 'Email atau kata sandi belum cocok.';
  if (error?.code === 'email_not_confirmed') return 'Konfirmasi email akun Anda di Supabase.';
  if (error?.status === 429) return 'Tunggu sebentar sebelum mencoba masuk lagi.';
  return 'Gagal masuk. Periksa akun dan konfigurasi proyek Supabase.';
}

async function signIn(form) {
  if (!auth || state.authBusy) return;
  const inputs = new FormData(form);
  state.email = String(inputs.get('email') ?? '').trim();
  const password = String(inputs.get('password') ?? '');
  state.authBusy = true;
  state.authError = '';
  render();
  try {
    const { data, error } = await auth.auth.signInWithPassword({ email: state.email, password });
    if (error || !data.user || !data.session) throw error ?? new Error('Sesi kosong');
    state.email = '';
    setUser(data.user);
  } catch (error) {
    state.authError = loginError(error);
  } finally {
    state.authBusy = false;
    render();
  }
}

async function signOut() {
  if (!auth || state.authBusy) return;
  state.authBusy = true;
  state.authError = '';
  render();
  try {
    const { error } = await auth.auth.signOut({ scope: 'local' });
    if (error) throw error;
    setUser(null);
  } catch {
    state.authError = 'Gagal keluar dari akun. Coba lagi.';
  } finally {
    state.authBusy = false;
    render();
  }
}

function chooseFile(kind, file) {
  if (!state.user || !state.team?.editable || state.pendingSave || state.saving || !file || !sources.some(source => source.key === kind)) return;
  if (kind === 'roster' && state.month?.roster_id) return;
  if (!/\.(xlsx|xls|csv)$/i.test(file.name) || file.size === 0 || file.size > maxFileSize) {
    state.error = 'Pilih file Excel atau CSV berisi data dengan ukuran maksimal 64 MB.';
    render();
    return;
  }
  cancelAudit();
  state.files[kind] = file;
  state.error = '';
  state.notice = '';
  render();
}

function updatePeriod(input) {
  if (state.demo || state.pendingSave || state.saving || !['period', 'start', 'end'].includes(input.name)) return;
  if (state[input.name] === input.value) return;
  if (input.name === 'period') {
    if (!daysInPeriod(input.value).length || input.value < state.retentionPeriod) {
      state.error = 'Pilih periode yang masih tersedia dalam masa simpan.';
      render();
      return;
    }
    resetAudit(input.value);
    void refreshMonth();
    return;
  }
  cancelAudit();
  state[input.name] = input.value;
  state.error = '';
  render();
}

function finishAudit(result, error = '') {
  cancelAudit();
  state.error = error;
  state.search = '';
  if (!result) {
    render();
    return;
  }
  state.pendingSave = { id: crypto.randomUUID(), files: { ...state.files }, result,
    storedRoster: state.month?.roster_id ? { id: state.month.roster_id, file: state.month.roster_file } : undefined };
  void persistResult();
}

async function runAudit(form) {
  if (!state.user || !state.team?.editable || state.busy || state.pendingSave || state.monthStatus !== 'ready') return;
  const formData = new FormData(form);
  const selection = Object.fromEntries(['period', 'start', 'end'].map(key => [key, String(formData.get(key) ?? '')]));
  if (!validCoverage(selection) || selection.period !== state.period || selection.period < state.retentionPeriod) {
    state.error = 'Pilih tanggal mulai dan akhir tarikan dalam periode absensi Sub Departemen.';
    render();
    return;
  }
  const month = state.month;
  if (Object.keys(state.files).length + Number(Boolean(month?.roster_id)) < 2) {
    state.error = 'Pilih setidaknya dua sumber pemeriksaan untuk Sub Departemen ini.';
    render();
    return;
  }
  Object.assign(state, selection);
  const generation = ++auditGeneration;
  state.busy = true;
  state.progress = 'Menyiapkan file…';
  state.error = '';
  state.notice = '';
  render();
  try {
    const files = Object.fromEntries(await Promise.all(Object.entries(state.files).map(async ([key, file]) =>
      [key, { name: file.name, bytes: await file.arrayBuffer() }])));
    if (generation !== auditGeneration) return;
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      if (generation !== auditGeneration) return;
      if (data.type === 'progress') showProgress(data.message);
      else if (data.type === 'result') finishAudit(data.result);
      else if (data.type === 'error') finishAudit(null, data.message);
    });
    worker.addEventListener('error', () => {
      if (generation === auditGeneration) finishAudit(null, 'File gagal diproses. Periksa format file sumber.');
    });
    worker.postMessage({ files, ...selection, rangeOnly: true, rosterRows: month?.roster_rows,
      grades: state.grades, captureRoster: Boolean(files.roster) }, Object.values(files).map(file => file.bytes));
  } catch {
    if (generation === auditGeneration) finishAudit(null, 'File gagal dibaca. Pilih ulang file sumber.');
  }
}

function showProgress(message) {
  state.progress = message;
  const status = document.querySelector('#audit-progress');
  if (status) status.textContent = message;
}

async function persistResult() {
  if (!state.user || !state.team?.editable || !state.pendingSave || saveRequest) return;
  const pending = state.pendingSave;
  const team = state.team;
  const controller = new AbortController();
  saveRequest = controller;
  state.saving = true;
  state.error = '';
  state.progress = 'Menyiapkan penyimpanan…';
  render();
  try {
    await saveCheck(auth, {
      projectUrl: state.config.url, owner: state.user.id, teamId: team.id, ...pending, signal: controller.signal,
      onUpload: kind => {
        if (saveRequest !== controller) return;
        const label = sources.find(source => source.key === kind)?.name;
        showProgress(label ? `Menyimpan ${label}…` : 'Menyimpan hasil pemeriksaan…');
      },
    });
    if (saveRequest !== controller) return;
    state.files = {};
    state.pendingSave = null;
    state.showUpload = false;
    if (pending.result.period > state.latestPeriod) state.latestPeriod = pending.result.period;
    state.notice = `${team.name} · tanggal ${coverageText(pending.result.days.map(day => day.key))} tersimpan.`;
    await refreshMonth();
  } catch (error) {
    if (saveRequest === controller) state.error = storageError(error, 'Gagal menyimpan pemeriksaan. Coba simpan lagi.');
  } finally {
    if (saveRequest === controller) {
      saveRequest = null;
      state.saving = false;
      render();
    }
  }
}

function showHistory() {
  if (!state.user || !state.team || state.saving || state.busy || state.pendingSave || state.monthStatus !== 'ready') return;
  const dialog = document.querySelector('#history-dialog');
  const emptyPage = () => ({ rows: [], cursor: null, more: false, loading: false, loaded: false, error: '' });
  history = { dialog, tab: 'archives', archives: emptyPage(), activity: emptyPage(), teamName: state.team.name };
  dialog.innerHTML = historyDialog(history);
  dialog.showModal();
  void loadHistory();
}

async function loadHistory() {
  const page = history;
  if (!page?.dialog.open) return;
  const tab = page.tab;
  const section = page[tab];
  if (section.loading) return;
  section.loading = true;
  section.error = '';
  page.dialog.innerHTML = historyDialog(page);
  try {
    const teamId = state.team.id;
    const signal = teamScope.signal;
    const { rows, hasMore, cursor } = tab === 'activity'
      ? await listTeamActivity(auth, teamId, section.cursor, signal)
      : await listMonths(auth, section.cursor, signal, teamId);
    section.rows.push(...rows);
    section.cursor = cursor;
    section.more = hasMore;
    section.loaded = true;
  } catch (error) {
    section.error = error instanceof Error ? error.message : storageError(error, 'Riwayat gagal dimuat. Coba lagi.');
  } finally {
    section.loading = false;
    if (history === page && page.dialog.open) page.dialog.innerHTML = historyDialog(page);
  }
}

function selectHistoryTab(tab) {
  if (!history?.dialog.open || !['archives', 'activity'].includes(tab)) return;
  history.tab = tab;
  history.dialog.innerHTML = historyDialog(history);
  if (!history[tab].loaded) void loadHistory();
}

async function openCheck(period) {
  if (!history?.dialog.open || history.archives.loading || !history.archives.rows.some(row => row.period === period)) return;
  history.dialog.close();
  resetAudit(period);
  state.showUpload = false;
  await refreshMonth();
  document.querySelector('#results')?.focus({ preventScroll: true });
}

function showFiles() {
  if (!state.user || !state.month || !state.batches.length) return;
  const dialog = document.querySelector('#files-dialog');
  dialog.innerHTML = filesDialog(state.month, state.batches);
  dialog.showModal();
}

async function downloadFile(kind, batchId, control) {
  if (!state.user || !state.team || state.downloading || !sources.some(source => source.key === kind)) return;
  const record = state.batches.find(batch => batch.id === batchId);
  const roster = kind === 'roster' && state.month?.roster_id;
  const id = roster ? state.month.roster_id : record?.id;
  const file = roster ? state.month.roster_file : record?.source_files[kind];
  if (!id || !file) return;
  const signal = teamScope.signal;
  const period = state.period;
  state.downloading = kind;
  const dialogNotice = document.querySelector('#file-download-error');
  if (dialogNotice) dialogNotice.hidden = true;
  if (control) control.disabled = true;
  try {
    const blob = await downloadSource(auth, state.team.id, id, kind, signal, true);
    if (signal.aborted || state.period !== period) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    if (signal.aborted || state.period !== period) return;
    const message = storageError(error, 'File gagal diunduh. Coba lagi.');
    if (dialogNotice?.isConnected) {
      dialogNotice.textContent = message;
      dialogNotice.hidden = false;
    } else {
      state.downloading = '';
      state.error = message;
      render();
    }
  } finally {
    if (!signal.aborted && state.period === period) state.downloading = '';
    if (control?.isConnected) control.disabled = false;
  }
}

function selectLeaveEditor(tab, id) {
  if (!leaveEditor || leaveEditor.busy) return;
  const rows = tab === 'permission' ? state.permissions : state.leaveRequests;
  const entry = id ? rows?.find(row => row.id === id) : null;
  if (id && !entry) return;
  Object.assign(leaveEditor, { tab, entry, error: '', notice: '' });
  render();
  if (id) document.querySelector('#form-nik')?.focus();
}

async function changeLeaveData(action, fallback) {
  const editor = leaveEditor;
  if (!editor || editor.busy || !state.leaveRequests || !state.team?.editable) return;
  const client = auth;
  const period = state.period;
  const signal = teamScope.signal;
  const teamId = state.team.id;
  Object.assign(editor, { busy: true, error: '', notice: '' });
  render();
  try {
    const message = await action(client, signal);
    if (signal.aborted || leaveEditor !== editor) return;
    if (!state.demo) {
      const extras = await readAttendanceExtras(client, period, signal, teamId);
      if (signal.aborted || leaveEditor !== editor) return;
      Object.assign(state, extras);
    }
    applyAttendanceExtras();
    Object.assign(editor, { entry: null, notice: message });
  } catch (error) {
    if (signal.aborted || leaveEditor !== editor) return;
    if (error?.code === '23505') editor.error = editor.tab === 'permission'
      ? 'Izin untuk NIK dan tanggal ini sudah tercatat. Pilih Ubah pada daftar.'
      : 'Salah satu rentang cuti sudah tercatat. Pilih Ubah pada daftar.';
    else if (error?.code === 'FORM_CUTI_EXCEL') editor.error = error.message;
    else if (error?.code === 'P0002') editor.error = 'Form Cuti sudah berubah. Muat ulang daftar.';
    else if (['42883', '42P01', 'PGRST202', 'PGRST205'].includes(error?.code)) {
      editor.error = 'Siapkan database Sub Departemen di Supabase, lalu muat ulang periode.';
    } else {
      editor.error = storageError(error, fallback);
    }
  } finally {
    if (leaveEditor === editor) {
      editor.busy = false;
      render();
    }
  }
}

function showLeaveError(message) {
  leaveEditor.error = message;
  leaveEditor.notice = '';
  render();
}

function saveDemoLeave(requests, deleteId) {
  if (deleteId) state.leaveRequests = state.leaveRequests.filter(row => row.id !== deleteId);
  let count = 0;
  for (const request of requests) {
    const same = state.leaveRequests.some(row => row.nik === request.nik && row.request_no === request.request_no
      && row.collected === request.collected && row.segments.length === request.segments.length
      && request.segments.every(segment => row.segments.some(item => item.kind === segment.kind
        && item.start_date === segment.start_date && item.end_date === segment.end_date)));
    if (!request.id && same) continue;
    state.leaveRequests = state.leaveRequests.filter(row => row.id !== request.id);
    state.leaveRequests.push({ ...request, id: request.id ?? crypto.randomUUID() });
    count++;
  }
  return count;
}

function persistLeaveRequests(client, requests, deleteId, signal) {
  if (state.demo) return saveDemoLeave(requests, deleteId);
  return saveLeaveRequests(client, requests, deleteId, signal, state.team.id);
}

async function changeLeave(form, deleteId) {
  if (leaveEditor?.tab !== 'leave' || leaveEditor.busy || !state.leaveRequests) return;
  let requests = [];
  if (form) {
    const inputs = new FormData(form);
    const kinds = leaveOrder;
    const dates = Object.fromEntries(kinds.map(kind => [kind, ['start_date', 'end_date'].map(edge =>
      String(inputs.get(`${kind}-${edge}`) ?? ''))]));
    const id = leaveEditor.entry?.id;
    const nik = normalizeCode(inputs.get('nik'));
    const number = String(inputs.get('request_no') ?? '').trim();
    const collected = inputs.get('collected') === 'yes';
    leaveEditor.entry = { id, nik, request_no: number, collected,
      segments: kinds.map(kind => ({ kind, start_date: dates[kind][0], end_date: dates[kind][1] })) };
    try {
      requests = [{ ...leaveRequest(nik, number, collected, dates), id }];
    } catch (error) {
      showLeaveError(error.message);
      return;
    }
  }
  await changeLeaveData(async (client, signal) => {
    await persistLeaveRequests(client, requests, deleteId, signal);
    return deleteId ? 'Form Cuti dihapus.' : 'Form Cuti tersimpan.';
  }, 'Perubahan Form Cuti gagal disimpan. Coba lagi.');
}

async function uploadLeave(file) {
  const editor = leaveEditor;
  if (!file || editor?.tab !== 'leave' || editor.busy || state.permissions === null) return;
  if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > maxFileSize) {
    showLeaveError('Pilih file Form Cuti Excel (.xlsx) berisi data dengan ukuran maksimal 64 MB.');
    return;
  }
  await changeLeaveData(async (client, signal) => {
    const { importLeaveFile } = await import('./import.js');
    const bytes = await file.arrayBuffer();
    let requests;
    try {
      requests = importLeaveFile(bytes, file.name);
    } catch (error) {
      throw Object.assign(error, { code: 'FORM_CUTI_EXCEL' });
    }
    signal.throwIfAborted();
    const added = await persistLeaveRequests(client, requests, null, signal);
    return added ? `${added} pengajuan baru disimpan dari ${requests.length} baris Excel.` : 'Semua pengajuan di file ini sudah tercatat.';
  }, 'Unggahan Form Cuti gagal disimpan. Coba lagi.');
}

async function changePermission(form, { removeId, approveId } = {}) {
  if (leaveEditor?.tab !== 'permission' || leaveEditor.busy || state.permissions === null) return;
  const id = removeId || approveId || leaveEditor.entry?.id;
  let entry = null;
  if (form) {
    const inputs = new FormData(form);
    entry = {
      nik: normalizeCode(inputs.get('nik')), code: normalizeCode(inputs.get('code')),
      permit_date: String(inputs.get('permit_date') ?? ''), approved: inputs.get('approved') === 'yes',
    };
    leaveEditor.entry = { ...entry, id };
    if (!entry.nik || !validDate(entry.permit_date) || !isPermissionCode(entry.code)) {
      showLeaveError('Isi NIK, tanggal, dan kode izin sesuai Absen, misalnya S untuk Sakit di Site.');
      return;
    }
  } else if (approveId) {
    const row = state.permissions.find(permit => permit.id === approveId);
    if (!row || row.approved) return;
    entry = { approved: true };
  }
  await changeLeaveData(async (client, signal) => {
    if (state.demo) {
      if (removeId) state.permissions = state.permissions.filter(row => row.id !== id);
      else if (id) state.permissions = state.permissions.map(row => row.id === id ? { ...row, ...entry } : row);
      else {
        if (state.permissions.some(row => row.nik === entry.nik && row.permit_date === entry.permit_date)) {
          throw Object.assign(new Error('Izin sudah tercatat.'), { code: '23505' });
        }
        state.permissions.push({ ...entry, id: crypto.randomUUID() });
      }
    } else if (removeId) await removePermission(client, id, signal, state.team.id);
    else await savePermission(client, entry, id, signal, state.team.id);
    return removeId ? 'Izin dihapus.' : approveId ? 'Izin disetujui.' : 'Izin tersimpan.';
  }, 'Perubahan izin gagal disimpan. Coba lagi.');
}

function openEmployeeDialog(rowIndex, dayIndex, fromCalendar = false) {
  const result = state.result;
  const employee = result?.employees[rowIndex];
  if (!employee) return;
  const dialog = document.querySelector('#detail-dialog');
  if (!dialog) return;
  if (dayIndex === undefined) {
    dialog.classList.add('employee-dialog');
    dialog.innerHTML = employeeCalendarView(result, employee, rowIndex, state.team?.editable);
  } else {
    const day = result.days[dayIndex];
    const cell = employee.cells[dayIndex];
    if (!day || !cell) return;
    dialog.classList.remove('employee-dialog');
    dialog.innerHTML = detailView(employee, day, cell, rowIndex, dayIndex, fromCalendar, state.team?.editable);
  }
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('#detail-title')?.focus({ preventScroll: true });
}

async function openManagement() {
  if (!canManage() || state.saving || state.busy || state.pendingSave || state.mutating) return;
  if (location.hash !== '#kelola') location.hash = '#kelola';
  if (management?.busy) return;
  management ??= { tab: state.profile.role === 'administrator' ? 'departments' : 'teams',
    data: null, entry: null, accessTeam: '', busy: false, error: '', notice: '' };
  const page = management;
  const signal = accountScope.signal;
  page.busy = true;
  render();
  try {
    page.data = await readManagement(auth, signal, state.profile.role === 'administrator');
    page.error = '';
  } catch {
    page.error = 'Daftar akun dan Sub Departemen gagal dimuat. Buka Kelola akses lagi.';
  } finally {
    if (!signal.aborted && management === page) {
      page.busy = false;
      render();
    }
  }
}

function editManagement(tab, id) {
  if (!management || management.busy || !canManage()) return;
  if (tab !== 'teams' && state.profile.role !== 'administrator') return;
  const rows = tab === 'departments' ? state.departments
    : tab === 'teams' && state.profile.role !== 'administrator' ? state.teams
      : management.data?.[tab] ?? [];
  const entry = id ? rows.find(row => (row.id ?? row.user_id) === id) : null;
  if (id && !entry) return;
  Object.assign(management, { tab, entry, notice: '', error: '' });
  render();
  if (id) root.querySelector('.workspace-management form input:not(:disabled), .workspace-management form select:not(:disabled)')?.focus();
}

async function changeManagement(action, message) {
  const page = management;
  if (!page || page.busy || !canManage()) return;
  const signal = accountScope.signal;
  page.busy = true;
  page.error = '';
  page.notice = '';
  state.mutating = true;
  render();
  try {
    await action(signal);
    if (signal.aborted || management !== page) return;
    page.entry = null;
    page.notice = message;
    await refreshWorkspace(true);
    if (!signal.aborted && canManage()) page.data = await readManagement(auth, signal, state.profile.role === 'administrator');
  } catch (error) {
    if (!signal.aborted && management === page) {
      page.error = error?.code === '23505' ? 'Nama ini sudah digunakan.' :
        error instanceof Error ? error.message : 'Perubahan gagal disimpan. Periksa hak akses dan coba lagi.';
    }
  } finally {
    if (!signal.aborted && management === page) {
      page.busy = false;
      state.mutating = false;
      render();
    }
  }
}

function submitManagement(form) {
  if (!management || management.busy) return;
  const inputs = new FormData(form);
  const entry = management.entry;
  const name = String(inputs.get('name') ?? '').trim();
  if (form.id === 'department-form' && state.profile?.role === 'administrator') {
    return changeManagement(signal => saveDepartment(auth, entry?.id ?? null, name, signal), 'Departemen tersimpan.');
  }
  if (form.id === 'team-form') {
    const department = entry?.department_id ?? String(inputs.get('department_id') ?? '');
    return changeManagement(signal => saveTeam(auth, entry?.id ?? null, department, name, signal), 'Sub Departemen tersimpan.');
  }
  if (form.id === 'account-form' && state.profile?.role === 'administrator') {
    const body = { role: 'department_admin', department_id: inputs.get('department_id') };
    if (entry?.user_id) Object.assign(body, { action: 'update', user_id: entry.user_id });
    else Object.assign(body, { action: 'create', email: inputs.get('email'), password: inputs.get('password') });
    return changeManagement(signal => manageAccount(auth, body, signal), 'Akun tersimpan.');
  }
}

function confirmAction(title, message, label, action) {
  const dialog = document.querySelector('#confirm-dialog');
  if (!dialog) return;
  pendingConfirmation = action;
  dialog.innerHTML = confirmationView(title, message, label);
  if (!dialog.open) dialog.showModal();
}

function changeAccountStatus(id, deleting) {
  if (state.profile?.role !== 'administrator' || management?.busy) return;
  const account = management?.data?.accounts.find(row => row.user_id === id && row.role !== 'administrator');
  if (!account) return;
  if (deleting) {
    confirmAction('Hapus akun', `Hapus akun ${account.email}?`, 'Hapus akun', () =>
      changeManagement(signal => manageAccount(auth, { action: 'delete', user_id: id }, signal), 'Akun dihapus.'));
  } else {
    void changeManagement(signal => manageAccount(auth, { action: 'set-active', user_id: id, active: !account.active }, signal),
      account.active ? 'Akun dinonaktifkan.' : 'Akun diaktifkan.');
  }
}

async function changeTeamSetting(action, rowIndex, dayIndex, fromCalendar) {
  if (!state.team?.editable || state.mutating || state.busy || state.saving) return;
  const signal = teamScope.signal;
  const teamId = state.team.id;
  const period = state.period;
  state.mutating = true;
  try {
    await action(signal);
    if (signal.aborted || state.team?.id !== teamId || state.period !== period) return;
    state.mutating = false;
    applyAttendanceExtras();
    render();
    openEmployeeDialog(rowIndex, dayIndex, fromCalendar);
  } catch {
    if (signal.aborted) return;
    const detail = document.querySelector('#detail-dialog .detail-reason, #detail-dialog .employee-legend');
    if (detail) {
      const notice = document.createElement('p');
      notice.className = 'notice error';
      notice.textContent = 'Perubahan gagal disimpan. Periksa hak akses Sub Departemen dan coba lagi.';
      detail.after(notice);
    }
  } finally {
    if (!signal.aborted) state.mutating = false;
  }
}

function changeGrade(input) {
  const rowIndex = Number(input.dataset.gradeRow);
  const employee = state.result?.employees[rowIndex];
  if (!employee) return;
  const grade = input.checked;
  input.checked = employee.gradeTwoUp;
  void changeTeamSetting(async signal => {
    if (!state.demo) await saveGrade(auth, state.team.id, employee.nik, grade, signal);
    if (!signal.aborted) state.grades = { ...state.grades, [employee.nik]: grade };
  }, rowIndex);
}

function reviewDay(input) {
  const rowIndex = Number(input.dataset.reviewRow);
  const dayIndex = Number(input.dataset.reviewDay);
  const fromCalendar = input.dataset.fromCalendar === 'true';
  const employee = state.result?.employees[rowIndex];
  const cell = employee?.cells[dayIndex];
  const date = state.result?.days[dayIndex]?.key;
  if (!date || !cell || !state.team?.editable || (cell.status !== 'red' && !cell.reviewed)) return;
  const checked = input.checked;
  input.checked = Boolean(cell.reviewed);
  const basis = checked ? reviewBasis(cell) : null;
  confirmAction(checked ? 'Konfirmasi pemeriksaan' : 'Batalkan tanda sudah dicek',
    `${employee.name} · ${formatDate(date)}. ${checked ? 'Tandai absensi tanggal ini sebagai sudah dicek?' : 'Tampilkan kembali peringatan tanggal ini?'}`,
    'Konfirmasi', () => changeTeamSetting(async signal => {
      if (!state.demo) await saveDayReview(auth, state.team.id, employee.nik, date, basis, signal);
      if (signal.aborted) return;
      state.reviews = state.reviews.filter(row => row.nik !== employee.nik || row.attendance_date !== date);
      if (basis) state.reviews.push({ nik: employee.nik, attendance_date: date, basis, reviewed_at: new Date().toISOString() });
    }, rowIndex, dayIndex, fromCalendar));
}

root.addEventListener('submit', async event => {
  const form = event.target;
  event.preventDefault();
  if (form.id === 'login-form') await signIn(form);
  if (form.id === 'audit-form') await runAudit(form);
  if (form.id === 'leave-form') await changeLeave(form);
  if (form.id === 'permission-form') await changePermission(form);
  if (['department-form', 'team-form', 'account-form'].includes(form.id)) await submitManagement(form);
  if (form.id === 'project-form' && !state.fixedConfig) {
    const data = new FormData(form);
    const errorArea = form.querySelector('#project-error');
    try {
      const config = validateProject({ url: String(data.get('url')), key: String(data.get('key')) });
      saveProject(config);
      state.authError = '';
      form.closest('dialog').close();
      await connectProject(config);
    } catch (error) {
      errorArea.textContent = error instanceof Error ? error.message : 'Pengaturan Supabase gagal disimpan.';
      errorArea.hidden = false;
    }
  }
});

root.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) {
    if (event.target instanceof HTMLDialogElement) event.target.close();
    return;
  }
  switch (control.dataset.action) {
    case 'project': {
      if (state.fixedConfig || state.authBusy) break;
      const dialog = document.querySelector('#project-dialog');
      dialog.innerHTML = projectDialog(state.config);
      dialog.showModal();
      break;
    }
    case 'close-dialog': control.closest('dialog')?.close(); break;
    case 'password': {
      const field = document.querySelector('#password');
      const visible = field.type === 'password';
      field.type = visible ? 'text' : 'password';
      control.setAttribute('aria-label', visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
      control.classList.toggle('password-visible', visible);
      break;
    }
    case 'demo': {
      if (state.user || state.authBusy) break;
      resetAudit();
      state.demo = true;
      state.baseResult = makeDemo();
      const team = { id: 'demo-team', department_id: 'demo-dept', name: 'Facility', editable: true };
      Object.assign(state, { workspaceStatus: 'ready', monthStatus: 'ready', departments: [{ id: 'demo-dept', name: 'GA Services' }],
        teams: [team], team, departmentName: 'GA Services', showUpload: false, latestPeriod: state.baseResult.period,
        checkLeave: readLeavePreference(team.id) });
      state.leaveRequests = [legacyLeaveRequest({ id: 'contoh-cuti', nik: 'DEMO003', kind: 'CE',
        start_date: '2026-11-05', end_date: '2026-11-05', collected: true })];
      state.permissions = [];
      applyAttendanceExtras();
      state.period = state.result.period;
      state.start = state.result.start;
      state.end = state.result.end;
      state.authError = '';
      render();
      break;
    }
    case 'exit-demo': state.demo = false; resetAudit(); calendarRoute(); render(); break;
    case 'logout': void signOut(); break;
    case 'refresh-workspace': void refreshWorkspace(); break;
    case 'select-team':
      if (!state.busy && !state.saving && !state.pendingSave && !state.mutating && !leaveEditor?.busy) void openTeam(control.dataset.id);
      break;
    case 'manage-workspace': void openManagement(); break;
    case 'management-tab': editManagement(control.dataset.tab); break;
    case 'edit-management': editManagement(control.dataset.type, control.dataset.id); break;
    case 'cancel-management': editManagement(management?.tab); break;
    case 'account-status': changeAccountStatus(control.dataset.id, false); break;
    case 'account-delete': changeAccountStatus(control.dataset.id, true); break;
    case 'cancel-confirm': pendingConfirmation = null; control.closest('dialog')?.close(); break;
    case 'accept-confirm': {
      const action = pendingConfirmation;
      pendingConfirmation = null;
      control.closest('dialog')?.close();
      if (action) void action();
      break;
    }
    case 'toggle-upload': state.showUpload = !state.showUpload; render(); break;
    case 'history': showHistory(); break;
    case 'history-tab': selectHistoryTab(control.dataset.tab); break;
    case 'load-history': void loadHistory(); break;
    case 'open-check': void openCheck(control.dataset.period); break;
    case 'download': void downloadFile(control.dataset.kind, control.dataset.batch, control); break;
    case 'files': showFiles(); break;
    case 'open-leave-page': if (state.team && !state.pendingSave) location.hash = '#form-cuti'; break;
    case 'back-dashboard': calendarRoute(); break;
    case 'leave-tab': selectLeaveEditor(control.dataset.tab); break;
    case 'edit-leave': selectLeaveEditor('leave', control.dataset.id); break;
    case 'delete-leave': void changeLeave(null, control.dataset.id); break;
    case 'choose-leave-file': document.querySelector('#leave-upload')?.click(); break;
    case 'edit-permission': selectLeaveEditor('permission', control.dataset.id); break;
    case 'approve-permission': void changePermission(null, { approveId: control.dataset.id }); break;
    case 'delete-permission': void changePermission(null, { removeId: control.dataset.id }); break;
    case 'refresh-month': void refreshMonth(); break;
    case 'retry-save': void persistResult(); break;
    case 'new-check': if (!state.saving) { resetAudit(state.period); render(); void refreshMonth(); } break;
    case 'choose-file': document.querySelector(`#file-${control.dataset.kind}`)?.click(); break;
    case 'remove-file':
      if (!state.pendingSave && state.team?.editable && !state.saving) {
        cancelAudit(); delete state.files[control.dataset.kind];
        if (state.monthStatus !== 'ready') state.result = null;
        state.error = ''; render();
      }
      break;
    case 'employee-calendar': openEmployeeDialog(Number(control.dataset.row)); break;
    case 'filter-warning': {
      const filter = control.dataset.filter;
      if (!['', 'red', 'yellow', 'purple', 'orange'].includes(filter)) break;
      state.warningFilter = state.warningFilter === filter ? '' : filter;
      render();
      root.querySelector(`[data-action="filter-warning"][data-filter="${filter}"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'detail':
      openEmployeeDialog(Number(control.dataset.row), Number(control.dataset.day), control.dataset.fromCalendar === 'true');
      break;
  }
});

root.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.file) chooseFile(input.dataset.file, input.files?.[0]);
  else if (input.id === 'leave-upload') void uploadLeave(input.files?.[0]);
  else if (input.id === 'check-leave' && state.team) {
    state.checkLeave = input.checked;
    try { localStorage.setItem(leavePreferenceKey(state.team.id), state.checkLeave ? 'on' : 'off'); } catch { /* session-only setting */ }
    applyAttendanceExtras();
    render();
    root.querySelector('#check-leave')?.focus({ preventScroll: true });
  } else if (input.id === 'access-team' && management) {
    management.accessTeam = input.value;
    render();
  } else if (input.dataset.grantUser) {
    const { team, grantUser } = input.dataset;
    const checked = input.checked;
    void changeManagement(signal => setTeamAccess(auth, team, grantUser, checked, signal), 'Akses Sub Departemen tersimpan.');
  } else if (input.dataset.gradeRow !== undefined) changeGrade(input);
  else if (input.dataset.reviewRow !== undefined) reviewDay(input);
  else if (input.id === 'form-period' || input.closest('#audit-form')) updatePeriod(input);
});

window.addEventListener('hashchange', () => {
  if (location.hash === '#kelola' && canManage() && !management) void openManagement();
  else render();
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.user || state.workspaceStatus !== 'ready' || state.saving || state.mutating) return;
  const signal = accountScope.signal;
  try {
    const next = await readWorkspace(auth, signal);
    if (signal.aborted) return;
    const selected = next?.teams.find(team => team.id === state.team?.id);
    if (!next?.profile?.active || next.profile.role !== state.profile?.role || (state.team && !selected)) {
      await refreshWorkspace(true);
    }
  } catch { /* Database policies enforce access while connectivity is unavailable. */ }
});

root.addEventListener('input', event => {
  if (event.target.id !== 'employee-search' || !state.result) return;
  state.search = event.target.value;
  document.querySelector('#attendance-calendar').innerHTML = calendarContent(state.result, state.search, state.warningFilter);
});

root.addEventListener('dragover', event => {
  const card = event.target.closest('[data-drop]');
  if (!card || !state.user || !state.team?.editable || state.pendingSave || state.saving) return;
  if (card.dataset.drop === 'roster' && state.month?.roster_id) return;
  event.preventDefault();
  card.classList.add('dragging');
});

root.addEventListener('dragleave', event => {
  const card = event.target.closest('[data-drop]');
  if (card && !card.contains(event.relatedTarget)) card.classList.remove('dragging');
});

root.addEventListener('drop', event => {
  const card = event.target.closest('[data-drop]');
  if (!card) return;
  event.preventDefault();
  card.classList.remove('dragging');
  if (state.user && !state.demo) chooseFile(card.dataset.drop, event.dataTransfer.files[0]);
});

resetAudit();
try {
  const { config, fixed } = initialProject();
  state.fixedConfig = fixed;
  void connectProject(config);
} catch (error) {
  state.authError = error instanceof Error ? error.message : 'Konfigurasi Supabase perlu diperiksa.';
  render();
}
