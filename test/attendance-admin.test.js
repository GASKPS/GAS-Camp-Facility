import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceAdminHandler } from '../supabase/functions/attendance-admin/handler.js';

const project = 'https://example.supabase.co';
const actor = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const target = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const department = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const request = (body, headers = {}) => new Request('https://example.supabase.co/functions/v1/attendance-admin', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const session = { Authorization: 'Bearer fixture' };

test('account commands reject anonymous, inactive and department accounts', async () => {
  let profile;
  const handler = attendanceAdminHandler({
    auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  }, project);
  assert.equal((await handler(request({ action: 'create' }))).status, 401);
  profile = { role: 'administrator', active: false };
  assert.equal((await handler(request({ action: 'create' }, session))).status, 403);
  profile = { role: 'department_admin', active: true };
  assert.equal((await handler(request({ action: 'create' }, session))).status, 403);
});

test('administrator provisions a scoped account and soft-deletes it after blocking access', async () => {
  const calls = [];
  const profiles = new Map([[actor, { role: 'administrator', active: true }]]);
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } } }),
      admin: {
        createUser: async entry => { calls.push(['create', entry.email]); return { data: { user: { id: target } } }; },
        deleteUser: async (id, soft) => { calls.push(['delete-auth', id, soft, profiles.get(id).active]); return {}; },
      },
    },
    from: table => ({
      select: () => ({ eq: (_, id) => ({ maybeSingle: async () => ({ data: table === 'attendance_departments' ? { id: department } : profiles.get(id) }) }) }),
      insert: async row => { profiles.set(row.user_id, row); return {}; },
      update: row => ({ eq: async (_, id) => { Object.assign(profiles.get(id), row); return {}; } }),
      delete: () => ({ eq: async (_, id) => { profiles.delete(id); return {}; } }),
    }),
  };
  const handler = attendanceAdminHandler(client, project);
  const creation = { action: 'create', email: 'team@example.com', password: 'fixture-only', department_id: department };
  assert.equal((await handler(request({ ...creation, role: 'administrator' }, session))).status, 400);
  assert.equal((await handler(request({ ...creation, role: 'department_admin' }, session))).status, 201);
  assert.equal(profiles.get(target).department_id, department);
  assert.equal((await handler(request({ action: 'delete', user_id: actor }, session))).status, 400);
  assert.equal((await handler(request({ action: 'delete', user_id: target }, session))).status, 200);
  assert.deepEqual(calls, [['create', 'team@example.com'], ['delete-auth', target, true, false]]);
  assert.equal(profiles.has(target), false);
});

test('archive cleanup authenticates the schedule and acknowledges files after Storage removes them', async () => {
  const calls = [];
  let remaining = [{ bucket: 'validasi-absensi-tim', path: 'team/check/absensi' }];
  const handler = attendanceAdminHandler({
    rpc: async (name, params) => {
      if (name === 'attendance_prepare_cleanup') {
        assert.equal(params.p_project_url, project);
        return params.p_key === 'fixture' ? {} : { error: { code: '42501' } };
      }
      if (name === 'attendance_cleanup_files') return { data: remaining };
      if (name === 'attendance_ack_cleanup') {
        calls.push(['ack', params.p_bucket, params.p_paths]);
        remaining = [];
        return {};
      }
      throw new Error('Unexpected RPC');
    },
    storage: { from: bucket => ({ remove: async paths => { calls.push(['remove', bucket, paths]); return {}; } }) },
  }, project);
  assert.equal((await handler(request({}, { 'x-attendance-cleanup': 'wrong' }))).status, 403);
  const response = await handler(request({}, { 'x-attendance-cleanup': 'fixture' }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ['remove', 'validasi-absensi-tim', ['team/check/absensi']],
    ['ack', 'validasi-absensi-tim', ['team/check/absensi']],
  ]);
});
