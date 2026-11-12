import { daysInPeriod, validCoverage } from './dates.js';

const skipRoster = new Set(['I', 'IK', 'NR']);
const noScans = new Set(['L', 'I', 'S', 'SL', 'CR', 'CT', 'CS', 'CE']);
const dayCodes = new Set(['D', 'D2', 'D3']);
const nonPermissionCodes = new Set(['D', 'D2', 'D3', 'N3', 'L', 'CR', 'CS']);
const rosterCodes = new Map([
  ['N', 'N3'], ['OFF', 'L'], ['C', 'CR'], ['CR', 'CR'], ['T', 'CT'], ['CT', 'CT'],
  ['COS', 'CS'], ['E', 'CE'], ['CE', 'CE'],
]);

export function expectedCode(rosterCode, weekday, gradeTwoUp = false) {
  if (rosterCode !== 'D') return rosterCodes.get(rosterCode) ?? '';
  if (gradeTwoUp) return 'D';
  return weekday === 5 ? 'D2' : 'D3';
}

export function normalizeCode(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isPermissionCode(code) {
  return Boolean(code && !nonPermissionCodes.has(code));
}

export function createFingerIndex(period, sheetName) {
  return { period, sheetName, rows: 0, invalid: 0, ids: new Set(), byId: new Map() };
}

export function recordScan(index, { id, date, seconds, direction }) {
  index.rows++;
  if (id) index.ids.add(id);
  const valid = id && date && Number.isInteger(seconds) && (direction === 'IN' || direction === 'OUT');
  if (!valid) index.invalid++;
  if (!id || !date) return;
  if (!date.startsWith(`${index.period}-`)) return;

  if (!index.byId.has(id)) index.byId.set(id, new Map());
  const dates = index.byId.get(id);
  if (!dates.has(date)) dates.set(date, { firstIn: null, lastOut: null, nightIn: false, nightOut: false, invalid: false });
  const scans = dates.get(date);
  if (!valid) {
    scans.invalid = true;
  } else if (direction === 'IN') {
    scans.firstIn = scans.firstIn === null ? seconds : Math.min(scans.firstIn, seconds);
    if (seconds >= 10 * 3600 && seconds <= 13 * 3600) scans.nightIn = true;
  } else {
    scans.lastOut = scans.lastOut === null ? seconds : Math.max(scans.lastOut, seconds);
    if (seconds >= 23 * 3600 && seconds < 24 * 3600) scans.nightOut = true;
  }
}

function countBy(rows, field) {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return counts;
}

function rosterIssue(cell, evidence, code, expected, hasAttendance) {
  if (!evidence.scheduled) return 'NIK belum ada di roster.';
  if (evidence.rosterDuplicate) return 'NIK tercatat lebih dari sekali di roster.';
  if (!cell.rosterCode) return 'Kode roster kosong untuk tanggal ini.';
  if (skipRoster.has(cell.rosterCode)) return '';
  if (!expected) return `Kode roster ${cell.rosterCode} belum dipetakan.`;
  if (hasAttendance && code !== expected) return `Seharusnya ${expected} dari roster.`;
  return '';
}

function codeIssue(code, weekday, gradeTwoUp, hasAttendance, hasScan) {
  if (!hasAttendance) return '';
  if (!code) return hasScan ? 'Ada catatan Live Attendance tanpa kode absensi.' : 'Kode absensi kosong.';
  if (dayCodes.has(code) && gradeTwoUp && code !== 'D') return 'Kode absen siang untuk Golongan 2 Up adalah D.';
  if (code === 'D' && !gradeTwoUp) return 'Kode D berlaku untuk Golongan 2 Up.';
  if (code === 'D2' && weekday !== 5) return 'D2 tercatat di luar Jumat.';
  if (code === 'D3' && weekday === 5) return 'D3 tercatat pada Jumat.';
  if (!dayCodes.has(code) && code !== 'N3' && !noScans.has(code)) return `Kode absensi ${code} belum dikenali.`;
  return '';
}

function scanTimeIssue(code, evidence, hasIn, hasOut) {
  if (code === 'N3') {
    const inOutside = hasIn && !evidence.nightIn;
    const outOutside = hasOut && !evidence.nightOut;
    if (inOutside && outOutside) return 'In dan Out berada di luar jam N3.';
    if (inOutside) return 'In N3 harus pukul 10.00–13.00.';
    if (outOutside) return 'Out N3 harus pukul 23.00–23.59.';
  } else if (dayCodes.has(code) && evidence.nightIn && evidence.nightOut) {
    return 'Jam Live Attendance In dan Out cocok dengan N3.';
  }
  return '';
}

export function validateAttendanceCell(cell, day, sources, gradeTwoUp = false) {
  if (!cell.covered || !cell.evidence) return cell;
  const evidence = cell.evidence;
  const expected = expectedCode(cell.rosterCode, day.weekday, gradeTwoUp);
  const hasAttendance = sources.includes('absensi');
  const hasRoster = sources.includes('roster');
  const hasLive = sources.includes('finger');
  const code = hasAttendance ? cell.code : expected;
  const hasIn = hasLive && cell.firstIn !== null;
  const hasOut = hasLive && cell.lastOut !== null;
  const work = dayCodes.has(code) || code === 'N3';
  const updated = { ...cell, expected, status: cell.code ? 'normal' : 'empty', reason: '' };
  delete updated.issues;
  const issues = [
    evidence.absensiDuplicate ? 'NIK tercatat lebih dari sekali di absensi.' : '',
    hasLive && evidence.fingerDuplicate ? 'ID Live Attendance dipakai oleh lebih dari satu baris absensi.' : '',
    hasLive && evidence.scanInvalid ? 'Ada catatan Live Attendance dengan jam atau arah In/Out yang perlu diperiksa.' : '',
    hasRoster ? rosterIssue(cell, evidence, code, expected, hasAttendance) : '',
    codeIssue(code, day.weekday, gradeTwoUp, hasAttendance, hasIn || hasOut),
    hasLive ? scanTimeIssue(code, evidence, hasIn, hasOut) : '',
    hasLive && noScans.has(code) && (hasIn || hasOut) ? 'Ada catatan Live Attendance pada hari berkode tanpa kehadiran.' : '',
  ].filter(Boolean);
  if (cell.rosterCode === 'COS' || (hasAttendance && code === 'CS')) issues.push('Cuti on site perlu dicek.');
  if (hasLive && work && !hasIn && !hasOut) {
    const absentId = evidence.fingerIdKnown ? '' : 'ID belum ada di Tarikan Live Attendance.';
    return { ...updated, status: 'purple', reason: ['In dan Out sama-sama kosong.', absentId, ...issues].filter(Boolean).join(' ') };
  }
  if (issues.length) return { ...updated, status: 'red', reason: issues.join(' '), issues };
  if (hasLive && work && (!hasIn || !hasOut)) return {
    ...updated, status: 'yellow', reason: hasIn ? 'Live Attendance Out kosong.' : 'Live Attendance In kosong.',
  };
  return updated;
}

export function auditAttendance({ absensi, roster, finger, period, start, end, rangeOnly = false, grades = {} }) {
  if (!validCoverage({ period, start, end })) throw new Error('Pilih rentang tarikan lengkap di dalam periode absensi.');
  const sources = Object.fromEntries([
    ['absensi', absensi && { rows: absensi.rows.length, sheetName: absensi.sheetName }],
    ['roster', roster && { rows: roster.rows.length, sheetName: roster.sheetName }],
    ['finger', finger && { rows: finger.rows, sheetName: finger.sheetName }],
  ].filter(([, source]) => source));
  const sourceKeys = Object.keys(sources);
  if (sourceKeys.length < 2) throw new Error('Pilih setidaknya dua sumber pemeriksaan.');

  const days = daysInPeriod(period).filter(day => !rangeOnly || (day.key >= start && day.key <= end));
  const rosterRows = roster?.rows ?? [];
  const inputRows = absensi?.rows ?? rosterRows;
  const scheduleByNik = new Map(rosterRows.map(row => [row.nik, row]));
  const counts = { absensi: countBy(absensi?.rows ?? [], 'nik'), finger: countBy(absensi?.rows ?? [], 'fingerId'), roster: countBy(rosterRows, 'nik') };
  const totals = { employees: inputRows.length, red: 0, yellow: 0, purple: 0 };

  const employees = inputRows.map(employee => {
    const schedule = scheduleByNik.get(employee.nik);
    const fingerId = employee.fingerId || employee.nik;
    const scans = finger?.byId.get(fingerId);
    const cells = days.map(day => {
      const code = employee.codes[day.day] ?? '';
      const rosterCode = schedule?.codes[day.day] ?? '';
      const scan = scans?.get(day.key);
      const evidence = {
        scheduled: Boolean(schedule), rosterDuplicate: (counts.roster.get(employee.nik) ?? 0) > 1,
        absensiDuplicate: (counts.absensi.get(employee.nik) ?? 0) > 1,
        fingerDuplicate: (counts.finger.get(fingerId) ?? 0) > 1,
        scanInvalid: Boolean(scan?.invalid), fingerIdKnown: Boolean(finger?.ids.has(fingerId)),
        nightIn: Boolean(scan?.nightIn), nightOut: Boolean(scan?.nightOut),
      };
      const cell = validateAttendanceCell({
        code, rosterCode, expected: '', covered: day.key >= start && day.key <= end,
        status: code ? 'normal' : 'empty', reason: '', evidence,
        firstIn: scan?.firstIn ?? null, lastOut: scan?.lastOut ?? null,
      }, day, sourceKeys, grades[employee.nik] === true);
      if (Object.hasOwn(totals, cell.status)) totals[cell.status]++;
      return cell;
    });
    return { nik: employee.nik, name: employee.name, fingerId, cells };
  });

  return { period, start, end, days, totals, employees, sources, invalidFingerRows: finger?.invalid ?? 0,
    rosterOnly: absensi ? rosterRows.filter(row => !counts.absensi.has(row.nik)).length : 0 };
}
