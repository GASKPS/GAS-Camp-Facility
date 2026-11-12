import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { makeDemo } from '../src/demo.js';
import { downloadSource, listChecks, readCheck, saveCheck } from '../src/records.js';

test('retries a partial upload and reopens the saved result and unchanged original files', async () => {
  const owner = 'fa3de000-0230-4b27-93ce-1f2ab925ccda';
  const id = 'b9866ca3-b4f1-4e04-98ef-5a1d74e6e0c8';
  const oldId = 'b9866ca3-b4f1-4e04-98ef-5a1d74e6e0c7';
  const projectUrl = 'https://selaras-test.supabase.co';
  const completedAt = '2026-11-11T02:00:00+00:00';
  const signal = new AbortController().signal;
  const result = makeDemo();
  const files = {
    finger: new File([Uint8Array.of(31, 127, 9, 0)], 'Finger asli.xlsx'),
    roster: new File(['data roster'], 'Roster.csv'),
    absensi: new File(['data absensi'], 'Absensi.xls'),
  };
  const stored = new Map();
  const uploads = [];
  let row;
  let failRoster = true;
  let retiredFilesExist = true;
  const client = createClient(projectUrl, 'sb_publishable_test', {
    accessToken: async () => 'test-user-access-token',
    global: { fetch: async (url, request) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname === '/rest/v1/attendance_checks' && request.method === 'POST') {
        if (row) return Response.json({ code: '23505', message: 'Already exists' }, { status: 409 });
        row = { ...JSON.parse(request.body), completed_at: null };
        return new Response(null, { status: 201 });
      }
      if (pathname === '/rest/v1/attendance_checks') {
        if (searchParams.get('status') === 'eq.replaced') {
          assert.equal(searchParams.get('owner_id'), `eq.${owner}`);
          assert.equal(searchParams.get('period'), `eq.${result.period}`);
          return Response.json(retiredFilesExist ? [{ id: oldId }] : []);
        }
        if (searchParams.get('status') === 'eq.ready' && !searchParams.has('period')) {
          return Response.json(row.completed_at ? [row] : []);
        }
        const fields = searchParams.get('select').split(',');
        return Response.json(Object.fromEntries(fields.map(field => [field, row[field]])));
      }
      if (pathname === '/storage/v1/object/list/selaras-sumber') {
        assert.equal(JSON.parse(request.body).prefix, `${owner}/${id}`);
        return Response.json([...stored.keys()].map(name => ({ name })));
      }
      if (pathname === '/rest/v1/rpc/complete_attendance_check') {
        const { p_check_id, p_result } = JSON.parse(request.body);
        assert.equal(p_check_id, id);
        assert.equal(stored.size, 3);
        Object.assign(row, { completed_at: completedAt, result: p_result, totals: p_result.totals });
        return Response.json(completedAt);
      }
      if (pathname === '/storage/v1/object/selaras-sumber' && request.method === 'DELETE') {
        assert.deepEqual(JSON.parse(request.body).prefixes, Object.keys(files).map(kind => `${owner}/${oldId}/${kind}`));
        retiredFilesExist = false;
        return Response.json([]);
      }
      const kind = pathname.split('/').at(-1);
      assert.ok(pathname.endsWith(`/selaras-sumber/${owner}/${id}/${kind}`));
      if (request.method === 'POST') {
        uploads.push(kind);
        if (kind === 'roster' && failRoster) {
          failRoster = false;
          return Response.json({ message: 'Network upload failed' }, { status: 500 });
        }
        const blob = [...request.body.values()].find(value => value instanceof Blob);
        assert.ok(blob);
        stored.set(kind, blob);
        return Response.json({ Id: kind, Key: `selaras-sumber/${owner}/${id}/${kind}` });
      }
      return new Response(stored.get(kind));
    } },
  });
  const options = { projectUrl, owner, id, files, result, signal, onUpload: () => {} };

  await assert.rejects(saveCheck(client, options), /Network upload failed/);
  assert.deepEqual(await listChecks(client, null, signal), { rows: [], hasMore: false, cursor: null });
  const saved = await saveCheck(client, options);
  assert.equal(saved.completed_at, completedAt);
  assert.equal(retiredFilesExist, false);
  assert.deepEqual(uploads, ['finger', 'roster', 'roster', 'absensi']);
  assert.deepEqual(await saveCheck(client, options), saved);
  assert.equal(uploads.length, 4);
  assert.equal((await listChecks(client, null, signal)).rows[0].id, id);
  assert.deepEqual((await readCheck(client, result.period, signal)).result, result);
  for (const [kind, file] of Object.entries(files)) {
    assert.equal(saved.source_files[kind].name, file.name);
    assert.equal(saved.source_files[kind].size, file.size);
    assert.deepEqual(await (await downloadSource(client, owner, id, kind, signal)).arrayBuffer(), await file.arrayBuffer());
  }
});

test('history shows the newest result per year and month even with several older saves', async () => {
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: `check-${index}`, period: '2026-11', completed_at: new Date(Date.UTC(2026, 10, 12, 0, -index)).toISOString(),
  }));
  records.push({ id: 'october', period: '2026-10', completed_at: '2026-10-31T12:00:00.000Z' },
    { id: 'prior-year', period: '2025-11', completed_at: '2025-11-30T12:00:00.000Z' });
  const client = createClient('https://monthly-test.supabase.co', 'sb_publishable_test', {
    accessToken: async () => 'test-user-access-token',
    global: { fetch: async url => {
      const { searchParams } = new URL(url);
      const before = /completed_at\.lt\.([^,]+)/.exec(searchParams.get('or') ?? '')?.[1];
      const page = before ? records.filter(record => record.completed_at < before) : records;
      return Response.json(page.slice(0, Number(searchParams.get('limit'))));
    } },
  });
  const page = await listChecks(client, null, new AbortController().signal);
  assert.deepEqual(page.rows.map(row => row.id), ['check-0', 'october', 'prior-year']);
  assert.equal(page.hasMore, false);
});
