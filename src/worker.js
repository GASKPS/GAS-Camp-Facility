import { auditAttendance } from './audit.js';
import { importAttendanceFile } from './import.js';
import { sourceNames } from './labels.js';

self.addEventListener('message', ({ data }) => {
  const { files, period, start, end, rangeOnly, captureRoster } = data;
  try {
    const inputs = {};
    for (const kind of ['absensi', 'roster', 'finger']) {
      if (!files[kind] && !(kind === 'roster' && data.rosterRows)) continue;
      self.postMessage({ type: 'progress', message: `Membaca ${sourceNames[kind]}…` });
      inputs[kind] = kind === 'roster' && data.rosterRows
        ? { rows: data.rosterRows, sheetName: 'Roster' }
        : importAttendanceFile(files[kind].bytes, files[kind].name, kind, period);
    }
    self.postMessage({ type: 'progress', message: 'Mencocokkan NIK dan tanggal…' });
    const result = auditAttendance({ ...inputs, period, start, end, rangeOnly, grades: data.grades });
    if (captureRoster && inputs.roster) result.rosterRows = inputs.roster.rows;
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Pemeriksaan gagal.' });
  }
});
