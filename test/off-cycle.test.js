import assert from 'node:assert/strict';
import test from 'node:test';
import { daysInPeriod } from '../src/dates.js';
import { applyManualReviews, applyOffCycle, reviewBasis } from '../src/off-cycle.js';

function range(period, start, codes) {
  const days = daysInPeriod(period).slice(start - 1, start - 1 + codes.length);
  const cells = codes.map(code => ({
    code, rosterCode: code === 'L' ? 'OFF' : code === 'CS' ? 'COS' : 'D', covered: true,
    status: code === 'CS' ? 'red' : 'normal', reason: code === 'CS' ? 'Cuti on site perlu dicek.' : '',
  }));
  return { period, days, sources: { absensi: {}, roster: {} }, employees: [{ nik: '01', cells }] };
}

test('OFF cycle spans months and includes short deductions and sick days', () => {
  const october = range('2026-10', 24, Array(8).fill('D3'));
  const november = range('2026-11', 1, ['D3', 'CT', 'CT', 'CT', 'S', 'D3', 'L', 'D3']);
  const [, result] = applyOffCycle([october, november]);
  assert.equal(result.employees[0].cells[4].offReason, undefined);
  assert.equal(result.employees[0].cells[5].offReason, 'Hari ke-14 dalam siklus tanpa OFF.');
  assert.equal(result.employees[0].cells[7].offReason, undefined);
  assert.deepEqual(result.employees[0].cells[7].offCycle, {
    position: 1, counted: true, start: { kind: 'roster', date: '2026-11-07' }, lastOff: { kind: 'roster', date: '2026-11-07' },
  });
});

test('a CR combination restarts the cycle and COS adds its own reviewable warning', () => {
  const october = range('2026-10', 18, [...Array(12).fill('D3'), 'CR', 'CR']);
  const november = range('2026-11', 1, ['CT', 'CE', 'CS', ...Array(14).fill('D3')]);
  const [, result] = applyOffCycle([october, november]);
  const cells = result.employees[0].cells;
  assert.match(cells[2].reason, /Cuti on site/);
  assert.deepEqual(cells[3].offCycle.start, { kind: 'leave', date: '2026-11-02' });
  assert.equal(cells[3].offCycle.position, 1);
  assert.equal(cells[15].offReason, undefined);
  assert.match(cells[16].offReason, /Hari ke-14/);
});

test('manual review is scoped to the original warning and leaves the purple status', () => {
  const result = range('2026-11', 1, ['CS', 'D3']);
  const [first, second] = result.employees[0].cells;
  first.checkId = 'upload-1';
  second.status = 'purple';
  const reviews = result.days.map((day, index) => ({
    nik: '01', attendance_date: day.key, basis: reviewBasis(result.employees[0].cells[index]),
  }));
  const cells = applyManualReviews(result, reviews).employees[0].cells;
  assert.equal(cells[0].status, 'green');
  assert.equal(cells[0].reason, first.reason);
  assert.equal(cells[1].status, 'purple');
  first.checkId = 'upload-2';
  assert.equal(applyManualReviews(result, reviews).employees[0].cells[0].status, 'red');
});

test('a confirmed L starts a new OFF cycle and a separate roster mismatch stays red', () => {
  const october = range('2026-10', 2, ['L', ...Array(12).fill('D3'), 'L', 'D2', ...Array(4).fill('D3')]);
  const cells = october.employees[0].cells;
  const on15 = cells[13];
  const on16 = cells[14];
  Object.assign(on15, { checkId: 'upload-oct', rosterCode: 'D', expected: 'D3', status: 'red', reason: 'Seharusnya D3 dari roster.' });
  Object.assign(on16, { rosterCode: 'OFF', expected: 'L', status: 'red', reason: 'Seharusnya L dari roster.' });
  const review = { nik: '01', attendance_date: '2026-10-15', basis: reviewBasis(on15) };
  const [unreviewed] = applyOffCycle([october]);
  assert.equal(unreviewed.employees[0].cells[18].offReason, 'Hari ke-17 dalam siklus tanpa OFF.');
  const [reviewed] = applyOffCycle([october], [review]);
  assert.equal(reviewed.employees[0].cells[18].offReason, undefined);
  assert.equal(reviewed.employees[0].cells[18].offCycle.position, 5);
  assert.deepEqual(reviewed.employees[0].cells[18].offCycle.lastOff, { kind: 'review', date: '2026-10-15' });
  assert.equal(reviewed.employees[0].cells[14].status, 'red');
  assert.equal(reviewed.employees[0].cells[14].reason, on16.reason);
});

test('a confirmed L carries across months for its reviewed upload', () => {
  const october = range('2026-10', 18, [...Array(13).fill('D3'), 'L']);
  const november = range('2026-11', 1, ['D3']);
  const off = october.employees[0].cells.at(-1);
  Object.assign(off, { checkId: 'upload-oct', rosterCode: 'D', expected: 'D3', status: 'red', reason: 'Seharusnya D3 dari roster.' });
  const review = { nik: '01', attendance_date: '2026-10-31', basis: reviewBasis(off) };
  const [, reviewed] = applyOffCycle([october, november], [review]);
  assert.equal(reviewed.employees[0].cells[0].offReason, undefined);
  off.checkId = 'replacement-upload';
  const [, corrected] = applyOffCycle([october, november], [review]);
  assert.equal(corrected.employees[0].cells[0].offReason, 'Hari ke-14 dalam siklus tanpa OFF.');
});
