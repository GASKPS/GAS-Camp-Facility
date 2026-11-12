import { isPermissionCode } from './audit.js';
import { totalsFor } from './monthly.js';

const work = new Set(['D', 'D2', 'D3', 'N3']);
const leave = new Set(['CR', 'CT', 'CE']);
const dayNumber = date => Date.parse(date + 'T00:00:00Z') / 86_400_000;
const dayKey = (nik, date) => `${nik}|${date}`;

function entryMap(results) {
  const employees = new Map();
  for (const result of results) {
    for (const employee of result.employees) {
      if (!employees.has(employee.nik)) employees.set(employee.nik, []);
      for (const [index, cell] of employee.cells.entries()) {
        const keys = cell.sourceKeys ?? Object.keys(result.sources ?? {});
        if (!cell.covered || !keys.includes('roster') || !keys.includes('absensi') || !cell.code || !cell.rosterCode) continue;
        const day = result.days[index];
        employees.get(employee.nik).push({ day: dayNumber(day.key), date: day.key, cell });
      }
    }
  }
  return employees;
}

function contiguousEnd(entries, start, accepts) {
  let end = start + 1;
  while (end < entries.length && entries[end].day === entries[end - 1].day + 1 && accepts(entries[end].cell)) end++;
  return end;
}

function reviewedOffUploads(reviews) {
  const uploads = new Map();
  for (const review of reviews) {
    try {
      const basis = JSON.parse(review.basis);
      if (!Array.isArray(basis)) continue;
      const [uploadId, code, , status] = basis;
      if (code === 'L' && status === 'red' && typeof uploadId === 'string' && uploadId) {
        uploads.set(dayKey(review.nik, review.attendance_date), uploadId);
      }
    } catch {
      // A review without a readable upload reference cannot confirm an OFF day.
    }
  }
  return uploads;
}

export function applyOffCycle(results, reviews = []) {
  const cycles = new Map();
  const reviewedOff = reviewedOffUploads(reviews);
  for (const [nik, entries] of entryMap(results)) {
    entries.sort((a, b) => a.day - b.day);
    let days = 0;
    let previous = -Infinity;
    let start;
    let lastOff = null;
    const remember = (entry, counted = false) => {
      cycles.set(dayKey(nik, entry.date), { position: days, counted, start, lastOff });
    };
    const count = entry => {
      days++;
      remember(entry, true);
    };

    for (let index = 0; index < entries.length;) {
      const entry = entries[index];
      const { cell } = entry;
      if (entry.day !== previous + 1) {
        days = 0;
        start = { kind: 'coverage', date: entry.date };
        lastOff = null;
      }
      previous = entry.day;
      const verifiedOff = cell.checkId && reviewedOff.get(dayKey(nik, entry.date)) === cell.checkId;
      if (cell.code === 'L' && (cell.rosterCode === 'OFF' || verifiedOff)) {
        days = 0;
        lastOff = { kind: cell.rosterCode === 'OFF' ? 'roster' : 'review', date: entry.date };
        start = lastOff;
        remember(entry);
      } else if (cell.code === 'CS' || cell.rosterCode === 'COS') {
        remember(entry);
      } else if (leave.has(cell.code)) {
        const block = contiguousEnd(entries, index, next => leave.has(next.code) && next.rosterCode !== 'COS');
        const leaveRows = entries.slice(index, block);
        if (leaveRows.some(row => row.cell.code === 'CR')) {
          days = 0;
          start = { kind: 'leave', date: entries[block - 1].date };
          for (const row of leaveRows) remember(row);
          previous = entries[block - 1].day;
          index = block;
          continue;
        }
        const short = contiguousEnd(entries, index, next => next.code === cell.code && next.rosterCode !== 'COS');
        const record = short - index <= 6 ? count : remember;
        for (const row of entries.slice(index, short)) record(row);
        previous = entries[short - 1].day;
        index = short;
        continue;
      } else if (work.has(cell.code) || (isPermissionCode(cell.code) && cell.rosterCode !== 'OFF')) {
        count(entry);
      } else {
        remember(entry);
      }
      index++;
    }
  }

  return results.map(result => {
    const employees = result.employees.map(employee => ({ ...employee, cells: employee.cells.map((cell, index) => {
      const offCycle = cycles.get(dayKey(employee.nik, result.days[index].key));
      if (!offCycle) return cell;
      return offCycle.counted && offCycle.position > 13
        ? { ...cell, offCycle, offReason: `Hari ke-${offCycle.position} dalam siklus tanpa OFF.`, status: cell.status === 'purple' ? 'purple' : 'red' }
        : { ...cell, offCycle };
    }) }));
    return { ...result, employees, totals: totalsFor(employees) };
  });
}

export function reviewBasis(cell) {
  return JSON.stringify([cell.checkId, cell.code, cell.expected, cell.status, cell.reason, cell.leaveReason,
    cell.permissionReason, cell.offReason, cell.firstIn, cell.lastOut]);
}

export function applyManualReviews(result, reviews) {
  if (!result) return null;
  const byDate = new Map(reviews.map(review => [dayKey(review.nik, review.attendance_date), review]));
  const employees = result.employees.map(employee => ({ ...employee, cells: employee.cells.map((cell, index) => {
    const review = byDate.get(dayKey(employee.nik, result.days[index].key));
    return cell.status === 'red' && review?.basis === reviewBasis(cell)
      ? { ...cell, status: 'green', reviewed: true, reviewedAt: review.reviewed_at } : cell;
  }) }));
  return { ...result, employees, totals: totalsFor(employees) };
}
