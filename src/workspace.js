import { daysInPeriod } from './dates.js';

const missingSchema = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

function dataOf(response) {
  if (response.error) throw response.error;
  return response.data;
}

async function pages(makeQuery, signal) {
  const rows = [];
  const size = 200;
  for (let offset = 0; ; offset += size) {
    const page = dataOf(await makeQuery().range(offset, offset + size - 1).abortSignal(signal));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

export async function readWorkspace(client, signal) {
  const response = await client.rpc('attendance_workspace', {}, { get: true }).abortSignal(signal);
  if (missingSchema.has(response.error?.code)) return null;
  return dataOf(response);
}

export async function readTeamSettings(client, team, firstPeriod, lastPeriod, signal) {
  const firstDate = daysInPeriod(firstPeriod)[0].key;
  const lastDate = daysInPeriod(lastPeriod).at(-1).key;
  const [people, reviews] = await Promise.all([
    pages(() => client.from('attendance_team_people').select('nik,grade_two_up').eq('team_id', team).order('nik'), signal),
    pages(() => client.from('attendance_team_reviews').select('nik,attendance_date,basis,reviewed_at')
      .eq('team_id', team).gte('attendance_date', firstDate).lte('attendance_date', lastDate)
      .order('nik').order('attendance_date'), signal),
  ]);
  return { grades: Object.fromEntries(people.map(row => [row.nik, row.grade_two_up])), reviews };
}

export async function saveGrade(client, teamId, nik, gradeTwoUp, signal) {
  return dataOf(await client.rpc('attendance_set_grade', { p_team: teamId, p_nik: nik, p_grade: gradeTwoUp }).abortSignal(signal));
}

export async function saveDayReview(client, teamId, nik, date, basis, signal) {
  return dataOf(await client.rpc('attendance_review_day', {
    p_team: teamId, p_nik: nik, p_date: date, p_basis: basis,
  }).abortSignal(signal));
}

export async function readManagement(client, signal, administrator) {
  if (!administrator) return { accounts: [], teams: [], grants: [] };
  const [accounts, teams, grants] = await Promise.all([
    pages(() => client.from('attendance_accounts').select('user_id,email,role,department_id,active').order('email').order('user_id'), signal),
    pages(() => client.from('attendance_teams').select('id,department_id,name').order('name').order('id'), signal),
    pages(() => client.from('attendance_team_access').select('team_id,user_id').order('team_id').order('user_id'), signal),
  ]);
  return { accounts, teams, grants };
}

export async function listTeamActivity(client, teamId, cursor, signal) {
  const limit = 20;
  const query = client.from('attendance_team_activity')
    .select('id,action,actor_email,start_date,end_date,corrected_dates,nik,occurred_at')
    .eq('team_id', teamId).order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) query.or(`occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`);
  const response = await query.abortSignal(signal);
  if (missingSchema.has(response.error?.code)) throw new Error('Aktifkan jejak perubahan dengan SQL pembaruan Sub Departemen di Supabase.');
  const page = dataOf(response);
  const rows = page.slice(0, limit);
  return { rows, cursor: rows.at(-1) ?? cursor, hasMore: page.length > limit };
}

export async function saveDepartment(client, id, name, signal) {
  return dataOf(await client.rpc('attendance_save_department', { p_id: id, p_name: name }).abortSignal(signal));
}

export async function saveTeam(client, id, department, name, signal) {
  return dataOf(await client.rpc('attendance_save_team', { p_id: id, p_department: department, p_name: name }).abortSignal(signal));
}

export async function setTeamAccess(client, team, user, enabled, signal) {
  return dataOf(await client.rpc('attendance_set_team_access', { p_team: team, p_user: user, p_enabled: enabled }).abortSignal(signal));
}

export async function manageAccount(client, body, signal) {
  const response = await client.functions.invoke('attendance-admin', { body, signal });
  if (!response.error) return response.data;
  let message = '';
  try {
    message = (await response.error.context?.json()).error;
  } catch {
    // A function gateway failure may not have a JSON response.
  }
  throw new Error(message || 'Layanan akun belum tersedia. Periksa fungsi attendance-admin di Supabase.');
}

export function periodOffset(period, months) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7);
}
