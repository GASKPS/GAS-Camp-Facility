import assert from 'node:assert/strict';
import test from 'node:test';
import { utils, write } from 'xlsx';
import { auditAttendance, createFingerIndex, recordScan } from '../src/audit.js';
import { importAttendanceFile, importLeaveFile } from '../src/import.js';
import { makeDemo } from '../src/demo.js';
import { validateProject } from '../src/auth.js';

const period = '2026-11';
const dates = Array.from({ length: 30 }, (_, day) => day + 1);

function excelFile(tables) {
  const workbook = utils.book_new();
  for (const [name, rows] of tables) utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name);
  return write(workbook, { type: 'array', bookType: 'xlsx' });
}

test('finds monthly headers beside hidden metadata and matches the three sources by NIK', () => {
  const roster = importAttendanceFile(excelFile([['Roster', [
    ['Periode November 2026'], ['No.', 'NIK', 'Nama', ...dates], ['FACILITY'],
    [1, 'F0002', 'Bima', 'OFF', 'T'], [2, 'F0001', 'Arif', 'D', 'N'],
  ]]]), 'roster.xlsx', 'roster', period);
  const absensi = importAttendanceFile(excelFile([['Absensi', [
    ['Periode 01 sd 30 November 2026'], ['NIK', 'Nama', 'Jabatan', 'ID Finger opsional'],
    [null, null, null, null, ...dates], ['F0001', 'Arif', 'Crew', 'M0001', 'D3', 'N3'],
    ['F0002', 'Bima', 'Crew', null, 'L', 'CR'],
  ]]]), 'absensi.xlsx', 'absensi', period);
  const csv = new TextEncoder().encode('Employee No.;Date;Time;In/Out\nM0001;2026-11-01;06:30:00;In\nM0001;2026-11-02;13:00:00;In\nM0001;2026-11-02;23:59:59;Out');
  const finger = importAttendanceFile(csv, 'finger.csv', 'finger', period);
  const result = auditAttendance({ absensi, roster, finger, period, start: '2026-11-01', end: '2026-11-02' });
  assert.equal(result.employees[0].cells[0].status, 'yellow');
  assert.equal(result.employees[0].cells[1].status, 'normal');
  assert.equal(result.employees[1].cells[0].status, 'normal');
  assert.equal(result.employees[1].cells[1].reason, 'Seharusnya CT dari roster.');
  assert.equal(result.totals.red, 1);
  assert.equal(result.totals.yellow, 1);
});

test('requires the named attendance sheet to match the selected period', () => {
  const file = excelFile([
    ['Absensi', [['Oktober 2026'], ['NIK', 'Nama', ...dates], ['F1', 'Arif', 'D3']]],
    ['Hasil', [['November 2026'], ['NIK', 'Nama', ...dates], ['F1', 'Arif', 'D3']]],
  ]);
  assert.throws(() => importAttendanceFile(file, 'absensi.xlsx', 'absensi', period), /Periode Absensi terbaca Oktober 2026/);
});

test('imports a combined Form Cuti, keeps leading zeros, and rejects an incomplete date pair', () => {
  const header = ['NIK', 'No. Pengajuan', 'CR Mulai', 'CR Selesai', 'CE Mulai', 'CE Selesai', 'CT Mulai', 'CT Selesai',
    'Status Pengumpulan', 'Hari CR', 'Hari CT', 'Hari CE'];
  const rows = [['Form Cuti'], header, ['00021', 'X-001', '2026-11-01', '2026-11-14', '15/11/2026', '16/11/2026',
    46_343, 46_343, 'Belum dikumpulkan', 14, 1, 2], [null, null, null, null, null, null, null, null, null, 0, 0, 0]];
  const parse = () => importLeaveFile(excelFile([['Form Cuti', rows]]), 'form.xlsx');
  assert.deepEqual(parse(), [{ nik: '00021', request_no: 'X-001', collected: false, segments: [
    { kind: 'CR', start_date: '2026-11-01', end_date: '2026-11-14' },
    { kind: 'CE', start_date: '2026-11-15', end_date: '2026-11-16' },
    { kind: 'CT', start_date: '2026-11-17', end_date: '2026-11-17' },
  ] }]);
  rows.push(['00022', null, null, null, null, null, '2026-11-17']);
  assert.throws(parse, /Baris 5.*mulai dan selesai CT/);
});

test('marks the reverse CT/CR mismatch and Friday daytime code from the roster', () => {
  const row = { nik: 'A', name: 'Arif', fingerId: 'A', codes: { 1: 'CT', 6: 'D3', 7: 'D3' } };
  const schedule = { ...row, codes: { 1: 'CR', 6: 'D', 7: 'NR' } };
  const finger = createFingerIndex(period, 'Finger');
  recordScan(finger, { id: 'A', date: '2026-11-06', seconds: 23_400, direction: 'IN' });
  recordScan(finger, { id: 'A', date: '2026-11-06', seconds: 64_800, direction: 'OUT' });
  recordScan(finger, { id: 'A', date: '2026-11-07', seconds: 0, direction: 'IN' });
  const result = auditAttendance({ absensi: { rows: [row] }, roster: { rows: [schedule] }, finger,
    period, start: '2026-11-01', end: '2026-11-07' });
  assert.equal(result.employees[0].cells[0].expected, 'CR');
  assert.equal(result.employees[0].cells[0].status, 'red');
  assert.equal(result.employees[0].cells[5].expected, 'D2');
  assert.equal(result.employees[0].cells[5].status, 'red');
  assert.equal(result.employees[0].cells[6].firstIn, 0);
  assert.equal(result.employees[0].cells[6].status, 'yellow');
});

test('computes sample results and validates browser-facing Supabase configuration', () => {
  assert.deepEqual(makeDemo().totals, { employees: 6, red: 3, yellow: 2, purple: 1 });
  const config = validateProject({ url: 'https://selaras-demo.supabase.co/', key: 'sb_publishable_example' });
  assert.equal(config.url, 'https://selaras-demo.supabase.co');
  assert.throws(() => validateProject({ ...config, key: 'sb_secret_example' }), /Publishable Key/);
  assert.throws(() => validateProject({ ...config, url: 'https://example.com' }), /Project URL/);
});

test('validates each available pair and uses the D code for Golongan 2 Up on Friday', () => {
  const range = { period, start: '2026-11-06', end: '2026-11-06', rangeOnly: true };
  const roster = { rows: [{ nik: 'A', name: 'Roster', codes: { 6: 'D' } }] };
  const absensi = { rows: [{ nik: 'A', name: 'Absensi', fingerId: 'A', codes: { 6: 'D' } }] };
  const finger = createFingerIndex(period, 'Live Attendance');
  const noScans = auditAttendance({ ...range, roster, absensi, grades: { A: true } });
  assert.equal(noScans.employees[0].cells[0].status, 'normal');
  assert.equal(noScans.employees[0].cells[0].expected, 'D');
  assert.equal(auditAttendance({ ...range, roster, absensi }).employees[0].cells[0].status, 'red');
  const missing = auditAttendance({ ...range, absensi, finger, grades: { A: true } });
  assert.equal(missing.employees[0].cells[0].status, 'purple');
  assert.match(missing.employees[0].cells[0].reason, /In dan Out sama-sama kosong/);
  assert.doesNotMatch(missing.employees[0].cells[0].reason, /belum ada di roster/);
  recordScan(finger, { id: 'A', date: range.start, seconds: 23_400, direction: 'IN' });
  const schedule = auditAttendance({ ...range, roster, finger });
  assert.equal(schedule.employees[0].name, 'Roster');
  assert.equal(schedule.employees[0].cells[0].code, 'D');
  assert.equal(schedule.employees[0].cells[0].status, 'yellow');
});

test('keeps the earliest In for detail while checking all N3 times on the same day', () => {
  const row = { nik: 'A', name: 'Arif', fingerId: 'A', codes: { 6: 'N3' } };
  const schedule = { ...row, codes: { 6: 'N' } };
  const finger = createFingerIndex(period, 'Live Attendance');
  for (const [seconds, direction] of [[36_900, 'IN'], [35_400, 'IN'], [43_200, 'IN'], [83_400, 'OUT'], [86_399, 'OUT']]) {
    recordScan(finger, { id: 'A', date: '2026-11-06', seconds, direction });
  }
  const result = auditAttendance({ absensi: { rows: [row] }, roster: { rows: [schedule] }, finger,
    period, start: '2026-11-06', end: '2026-11-06' });
  const cell = result.employees[0].cells[5];
  assert.equal(cell.firstIn, 35_400);
  assert.equal(cell.lastOut, 86_399);
  assert.equal(cell.status, 'normal');
});
