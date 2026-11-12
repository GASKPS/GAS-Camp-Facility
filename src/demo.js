import { auditAttendance, createFingerIndex, recordScan } from './audit.js';

const period = '2026-11';
const start = `${period}-01`;
const end = `${period}-08`;
const names = ['Arif Pratama', 'Nadia Putri', 'Dewi Lestari', 'Rangga Saputra', 'Nisa Ramadhani', 'Bima Wibowo'];
const schedule = [
  ['D', 'D', 'OFF', 'D', 'D', 'D', 'D', 'OFF'],
  ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N'],
  ['D', 'D', 'D', 'D', 'CT', 'D', 'D', 'OFF'],
  ['D', 'OFF', 'D', 'D', 'N', 'N', 'N', 'D'],
  ['D', 'D', 'OFF', 'D', 'D', 'D', 'D', 'D'],
  ['OFF', 'D', 'D', 'D', 'D', 'D', 'D', 'N'],
];

export function makeDemo() {
  const finger = createFingerIndex(period, 'Finger');
  const roster = { sheetName: 'Roster', rows: [] };
  const absensi = { sheetName: 'Absensi', rows: [] };
  names.forEach((name, index) => {
    const nik = `DEMO${String(index + 1).padStart(3, '0')}`;
    const rosterRow = { nik, name, codes: {} };
    const attendanceRow = { nik, name, fingerId: nik, codes: {} };
    schedule[index].forEach((shift, offset) => {
      const day = offset + 1;
      const date = `${period}-${String(day).padStart(2, '0')}`;
      let code = shift === 'D' ? (day === 6 ? 'D2' : 'D3') : shift === 'N' ? 'N3' : shift === 'OFF' ? 'L' : shift;
      if (index === 0 && day === 3) code = 'D3';
      if (index === 2 && day === 5) code = 'CR';
      rosterRow.codes[day] = shift;
      attendanceRow.codes[day] = code;

      if (!['D2', 'D3', 'N3'].includes(code) || (index === 5 && day === 7)) return;
      const night = code === 'N3';
      const inSeconds = index === 0 && day === 2 ? 7 * 3600 + 12 * 60
        : night ? 11 * 3600 + 15 * 60 : 6 * 3600 + (29 + index * 2) * 60;
      const outSeconds = index === 3 && day === 6 ? 22 * 3600 + 35 * 60 : night ? 23 * 3600 + 27 * 60 : 18 * 3600 + index * 60;
      if (!(index === 4 && day === 2)) recordScan(finger, { id: nik, date, seconds: inSeconds, direction: 'IN' });
      if (!(index === 1 && day === 4)) recordScan(finger, { id: nik, date, seconds: outSeconds, direction: 'OUT' });
    });
    roster.rows.push(rosterRow);
    absensi.rows.push(attendanceRow);
  });
  return auditAttendance({ absensi, roster, finger, period, start, end });
}
