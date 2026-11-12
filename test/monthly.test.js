import assert from 'node:assert/strict';
import test from 'node:test';
import { auditAttendance, createFingerIndex, recordScan } from '../src/audit.js';
import { daysInPeriod } from '../src/dates.js';
import { checkLeaveForms, coverageText, formAttendanceReview, mergeMonthlyResult } from '../src/monthly.js';

const period = '2026-11';
const days = daysInPeriod(period);
const roster = { nik: '001', name: 'Uji Roster', codes: { 1: 'C', 2: 'T', 3: 'E', 4: 'D', 5: 'D' } };
const empty = { code: '', rosterCode: '', expected: '', covered: false, status: 'empty', reason: '', firstIn: null, lastOut: null };

function batch(id, start, end, code, full = false) {
  const selected = full ? days : days.slice(start - 1, end);
  return { id, result: { days: selected, sources: {}, employees: [{ nik: roster.nik, name: roster.name, fingerId: id,
    cells: selected.map(day => ({ ...empty, code, rosterCode: roster.codes[day.day] ?? 'D', covered: true, status: 'normal' })) }] } };
}

test('monthly archive combines separate ranges and uses a new batch only on dates assigned to it', () => {
  const month = { period, roster_rows: [roster], coverage: {} };
  for (const day of days.slice(0, 5)) month.coverage[day.key] = 'awal';
  for (const day of days.slice(6, 17)) month.coverage[day.key] = 'lanjutan';
  month.coverage['2026-11-08'] = 'koreksi';
  const result = mergeMonthlyResult(month, [batch('awal', 1, 5, 'L', true), batch('lanjutan', 7, 17, 'D3'), batch('koreksi', 8, 8, 'N3')]);
  const cells = result.employees[0].cells;
  assert.equal(coverageText(result.coveredDays), '1–5, 7–17');
  assert.equal(cells[4].code, 'L');
  assert.equal(cells[5].covered, false);
  assert.equal(cells[5].code, '');
  assert.equal(cells[6].code, 'D3');
  assert.equal(cells[7].code, 'N3');
  assert.equal(cells[7].fingerId, 'koreksi');
  assert.equal(cells[8].code, 'D3');
});

function fixture(codes, rosterCodes = {}) {
  const month = { period, roster_rows: [roster], coverage: {} };
  const selected = days.filter(day => Object.hasOwn(codes, day.day));
  for (const day of selected) month.coverage[day.key] = 'awal';
  const cells = selected.map(day => ({ ...empty, code: codes[day.day], rosterCode: rosterCodes[day.day] ?? '', covered: true, status: 'normal' }));
  return mergeMonthlyResult(month, [{ id: 'awal', result: { days: selected, employees: [{ ...roster, name: 'Nama dari Absen', cells }] } }]);
}

const form = (kind, start, end, collected = true) => ({ nik: roster.nik, kind, start_date: days[start - 1].key, end_date: days[end - 1].key, collected });

test('Form Cuti matches each date and type against Absensi and preserves Roster warnings', () => {
  const base = fixture({ 1: 'CR', 2: 'CR', 3: 'CR', 4: 'CE', 5: 'CT', 6: 'D2' }, { 2: 'T', 4: 'T', 5: 'E' });
  const original = base.employees[0].cells;
  original[1].reason = 'Seharusnya CT dari roster.';
  original[1].status = 'red';
  const forms = [form('CR', 2, 3), form('CT', 4, 4), form('CT', 5, 5, false), form('CE', 6, 7)];
  const result = checkLeaveForms(base, forms);
  const cells = result.employees[0].cells;
  assert.match(cells[0].leaveReason, /CR.*belum tercatat/);
  assert.equal(cells[1].leaveReason, '');
  assert.equal(cells[1].reason, 'Seharusnya CT dari roster.');
  assert.equal(cells[2].status, 'normal');
  assert.match(cells[3].leaveReason, /Absen CE\. Form Cuti CT/);
  assert.match(cells[4].leaveReason, /CT belum dikumpulkan/);
  assert.match(cells[5].leaveReason, /Absen D2\. Form Cuti CE/);
  assert.equal(cells[6].leaveReason, undefined);
  assert.equal(result.totals.red, 5);
  assert.match(formAttendanceReview(forms[0], base, forms).message, /perlu mencakup tanggal 1/);
  assert.match(formAttendanceReview(forms[1], base, forms).message, /Absen tanggal 4 CE, Form Cuti CT/);
  assert.match(formAttendanceReview(forms[3], base, forms).message, /Periksa tanggal 6\./);
  const corrected = [form('CR', 1, 3), form('CE', 4, 4), form('CT', 5, 5)];
  assert.equal(checkLeaveForms(base, corrected).totals.red, 1);
});

test('form review respects adjacent requests, unexamined days and incorrect NIK', () => {
  const base = fixture({ 1: 'CR', 2: 'CR', 4: 'CT', 5: 'CT' });
  const forms = [form('CR', 1, 1), form('CR', 2, 3), form('CT', 4, 4)];
  assert.equal(formAttendanceReview(forms[0], base, forms).tone, 'green');
  assert.equal(formAttendanceReview(forms[1], base, forms).tone, 'green');
  assert.equal(formAttendanceReview(forms[2], base, forms).tone, 'red');
  assert.equal(formAttendanceReview(form('CE', 3, 3), base, forms).tone, 'uncovered');
  assert.equal(formAttendanceReview({ ...forms[0], nik: 'DIFFERENT' }, base, forms).tone, 'red');
  const permissions = [{ nik: roster.nik, permit_date: days[4].key, code: 'CT', approved: true }];
  assert.equal(formAttendanceReview(forms[2], base, forms, permissions).tone, 'green');
});

test('monthly and partial results keep actual Absensi employees, names and codes', () => {
  const rosterOnly = { nik: '002', name: 'Tanpa absen', codes: { 7: 'D' } };
  const partial = auditAttendance({
    roster: { rows: [roster, rosterOnly] },
    absensi: { rows: [{ ...roster, name: 'Nama Absen', fingerId: '001', codes: { 1: 'CR', 7: 'D3' } }] },
    finger: createFingerIndex(period, 'Live Attendance'),
    period, start: '2026-11-07', end: '2026-11-07', rangeOnly: true,
  });
  assert.deepEqual(partial.days.map(day => day.key), ['2026-11-07']);
  assert.deepEqual(partial.employees.map(row => row.nik), ['001']);
  const old = { ...partial, employees: [...partial.employees, { ...rosterOnly, cells: [empty] }] };
  const month = { period, roster_rows: [roster, rosterOnly], coverage: { '2026-11-07': 'awal' } };
  const merged = mergeMonthlyResult(month, [{ id: 'awal', result: old }]);
  assert.deepEqual(merged.employees.map(row => row.name), ['Nama Absen']);
  assert.equal(merged.employees[0].cells[6].code, 'D3');
  assert.equal(merged.employees[0].cells[0].covered, false);
});

test('only approved permission matching Absensi, date and NIK turns a permission issue green', () => {
  const base = fixture({ 1: 'S', 2: 'S', 3: 'I', 4: 'CT', 5: 'S', 6: 'D2' });
  const originals = base.employees[0].cells;
  originals[0].status = 'red';
  originals[0].reason = 'Seharusnya D3 dari roster.';
  originals[4].status = 'red';
  originals[4].reason = 'NIK belum ada di roster.';
  const permission = (day, code, approved = true) => ({ nik: roster.nik, permit_date: days[day - 1].key, code, approved });
  const permits = [permission(1, 'S'), permission(2, 'S', false), permission(3, 'S'), permission(4, 'CT'),
    permission(5, 'S'), { ...permission(6, 'S'), nik: 'OTHER' }];
  const checked = checkLeaveForms(base, [], permits).employees[0].cells;
  assert.deepEqual(checked.slice(0, 6).map(cell => cell.status), ['green', 'red', 'red', 'green', 'red', 'normal']);
  assert.match(checked[0].permissionReason, /disetujui/);
  assert.equal(checked[0].reason, '');
  assert.match(checked[1].permissionReason, /menunggu/);
  assert.match(checked[2].permissionReason, /Absen I.*kode S/);
  assert.equal(checked[4].reason, originals[4].reason);
  assert.equal(checkLeaveForms(base, [form('CR', 4, 4)], permits).employees[0].cells[3].status, 'red');
  assert.match(checkLeaveForms(base, [], []).employees[0].cells[0].permissionReason, /belum dicatat/);
});

test('D3 uses earliest In and marks strictly after 07:01:00, keeping red and yellow issues', () => {
  const row = { ...roster, fingerId: roster.nik, codes: { 1: 'D3', 2: 'D3', 3: 'D3', 4: 'D3', 5: 'D3', 6: 'D2' } };
  const finger = createFingerIndex(period, 'Live Attendance');
  for (const [day, times] of Object.entries({ 1: [25_261, 26_000], 2: [26_000, 25_260], 3: [25_261], 4: [25_261], 5: [26_000, 25_200], 6: [25_261] })) {
    const date = days[day - 1].key;
    for (const seconds of times) recordScan(finger, { id: row.nik, date, seconds, direction: 'IN' });
    if (day !== '3') recordScan(finger, { id: row.nik, date, seconds: 64_800, direction: 'OUT' });
  }
  const base = auditAttendance({ absensi: { rows: [row] }, roster: { rows: [{ ...roster, codes: { 1: 'D', 2: 'D', 3: 'D', 4: 'N', 5: 'D', 6: 'D' } }] },
    finger, period, start: days[0].key, end: days[5].key, rangeOnly: true });
  const checked = checkLeaveForms(base).employees[0].cells;
  assert.deepEqual(checked.map(cell => cell.status), ['orange', 'normal', 'yellow', 'red', 'normal', 'normal']);
  assert.match(checked[0].lateReason, /Terlambat.*07:01:01/);
  assert.match(checked[3].lateReason, /Terlambat/);
  assert.equal(checked[5].lateReason, undefined);
});
