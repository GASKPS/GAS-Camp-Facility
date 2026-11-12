import { read, SSF } from 'xlsx';
import { dateKey, formatPeriod } from './dates.js';
import { createFingerIndex, normalizeCode, recordScan } from './audit.js';
import { sourceNames as labels } from './labels.js';
import { leaveOrder, leaveRequest } from './leave.js';

const headerRows = 80;
const aliases = {
  nik: new Set(['nik', 'employeeno', 'employeenumber', 'employeeid', 'idkaryawan', 'nomorkaryawan', 'nopegawai', 'nip']),
  name: new Set(['nama', 'namakaryawan', 'namapegawai', 'employee', 'employeename', 'name']),
  fingerId: new Set(['idfinger', 'idfingeropsional', 'idliveattendance', 'idliveattendanceopsional', 'nomorfinger', 'idmesin', 'employeenomesin']),
  date: new Set(['date', 'tanggal', 'scandate', 'tanggalscan', 'attendancedate']),
  time: new Set(['time', 'jam', 'scantime', 'jamscan', 'attendancetime']),
  timestamp: new Set(['datetime', 'timestamp', 'scandatetime', 'tanggaljam', 'waktuscan']),
  direction: new Set(['inout', 'arah', 'arahscan', 'scantype', 'checktype', 'direction', 'attendanceinout']),
};
const monthNumbers = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['mei', 5], ['may', 5], ['jun', 6], ['jul', 7],
  ['agu', 8], ['aug', 8], ['sep', 9], ['okt', 10], ['oct', 10], ['nov', 11], ['des', 12], ['dec', 12],
]);
const monthWords = /\b(jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|mei|may|jun(?:i|e)?|jul(?:i|y)?|agu(?:stus)?|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)\.?[\s/-]+(\d{4})\b/i;

const valueOf = cell => cell?.v ?? '';
const headerKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const headerIndex = (row, keys) => row.findIndex(cell => keys.has(headerKey(valueOf(cell))));

function textValue(cell) {
  return String(valueOf(cell)).trim();
}

function idValue(cell) {
  const value = valueOf(cell);
  const display = cell?.w?.trim();
  return normalizeCode(typeof value === 'number' && /^0\d+$/.test(display ?? '') ? display : value);
}

function asDate(value, date1904) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return dateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number' && value >= 1) {
    const excelDate = SSF.parse_date_code(value, { date1904 });
    return excelDate ? dateKey(excelDate.y, excelDate.m, excelDate.d) : null;
  }
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T\s])/.exec(text);
  if (iso) return dateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:$|\s)/.exec(text);
  if (local) {
    const year = Number(local[3]);
    return dateKey(year < 100 ? 2000 + year : year, Number(local[2]), Number(local[1]));
  }
  const withMonth = /^(\d{1,2})[ -]([A-Za-z]+)\.?[ -](\d{2}|\d{4})(?:$|\s)/.exec(text);
  if (withMonth) {
    const year = Number(withMonth[3]);
    return dateKey(year < 100 ? 2000 + year : year, monthNumbers.get(withMonth[2].slice(0, 3).toLowerCase()), Number(withMonth[1]));
  }
  return null;
}

function asTime(value, combined) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds();
  }
  if (typeof value === 'number') {
    if (value < 0 || (!combined && value >= 1)) return null;
    const seconds = Math.round((value % 1) * 86400);
    return seconds < 86400 ? seconds : null;
  }
  let text = String(value ?? '').trim();
  if (combined) text = /[T\s](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)(?:$|[.Z+-])/i.exec(text)?.[1] ?? '';
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
  }
  return hour < 24 && minute < 60 && second < 60 ? hour * 3600 + minute * 60 + second : null;
}

function dayHeader(cell, date1904) {
  const value = valueOf(cell);
  const match = /^(?:tgl\.?\s*)?(\d{1,2})$/i.exec(String(value).trim());
  if (match) return { day: Number(match[1]), date: null };
  const date = asDate(value, date1904);
  return date ? { day: Number(date.slice(8)), date } : null;
}

function monthInTitle(value) {
  const text = String(value ?? '').trim();
  const words = monthWords.exec(text);
  if (words) return `${words[2]}-${String(monthNumbers.get(words[1].slice(0, 3).toLowerCase())).padStart(2, '0')}`;
  return /^(?:periode\s+)?(\d{4}-(?:0[1-9]|1[0-2]))$/i.exec(text)?.[1] ?? null;
}

function calendarLayout(rows, sheetName, date1904) {
  let best = null;
  for (let header = 0; header < Math.min(rows.length, headerRows); header++) {
    const row = rows[header] ?? [];
    const nik = headerIndex(row, aliases.nik);
    if (nik < 0) continue;
    const name = headerIndex(row, aliases.name);
    const fingerId = headerIndex(row, aliases.fingerId);
    const after = Math.max(nik, name, fingerId) + 1;
    for (let datesRow = Math.max(0, header - 3); datesRow <= Math.min(rows.length - 1, header + 5); datesRow++) {
      const dateCells = rows[datesRow] ?? [];
      const headers = dateCells.map(cell => dayHeader(cell, date1904));
      for (let col = after; col < headers.length; col++) {
        if (headers[col]?.day !== 1) continue;
        const columns = [];
        const months = new Set();
        for (let day = 1; day <= 31 && headers[col + day - 1]?.day === day; day++) {
          const item = headers[col + day - 1];
          if (item.date) months.add(item.date.slice(0, 7));
          columns.push([day, col + day - 1]);
        }
        if (columns.length >= 7 && (!best || columns.length > best.columns.length)) {
          best = { nik, name, fingerId, columns, months, start: Math.max(header, datesRow) + 1 };
        }
      }
    }
  }
  if (!best) return null;
  let period = [...best.months][0] ?? monthInTitle(sheetName);
  for (let row = 0; !period && row < Math.min(best.start, 14); row++) {
    period = (rows[row] ?? []).map(cell => monthInTitle(valueOf(cell))).find(Boolean) ?? null;
  }
  return { ...best, period };
}

function fingerLayout(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, headerRows); rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const nik = headerIndex(row, aliases.nik);
    const date = headerIndex(row, aliases.date);
    const time = headerIndex(row, aliases.time);
    const timestamp = headerIndex(row, aliases.timestamp);
    const direction = headerIndex(row, aliases.direction);
    if (nik >= 0 && direction >= 0 && ((date >= 0 && time >= 0) || timestamp >= 0)) {
      return { nik, date: date >= 0 ? date : timestamp, time: time >= 0 ? time : timestamp,
        combined: time < 0, direction, start: rowIndex + 1 };
    }
  }
  return null;
}

function exactSheetScore(name, kind) {
  const key = headerKey(name);
  const expected = kind === 'finger' ? ['liveattendance', 'tarikanliveattendance', 'finger', 'tarikanfinger', 'fingerprint'] : kind === 'absensi' ? ['absensi', 'absen'] : ['roster'];
  if (expected.includes(key)) return 2;
  return expected.some(word => key.includes(word)) ? 1 : 0;
}

function chooseSheet(workbook, kind, period, date1904) {
  const options = [];
  for (const name of workbook.SheetNames) {
    const rows = workbook.Sheets[name]?.['!data'] ?? [];
    const layout = kind === 'finger' ? fingerLayout(rows) : calendarLayout(rows, name, date1904);
    if (layout) options.push({ name, rows, layout });
  }
  if (options.length === 0) {
    const columns = kind === 'finger' ? 'Employee No., Date, Time, dan In/Out' : 'NIK dan kolom tanggal 1–31';
    throw new Error(`${labels[kind]} memerlukan header ${columns}. Periksa susunan file yang dipilih.`);
  }
  const named = options.filter(option => exactSheetScore(option.name, kind) === 2);
  const candidates = named.length ? named : options;
  const compatible = candidates.filter(({ layout }) => !layout.period || layout.period === period);
  if (!compatible.length) {
    throw new Error(`Periode ${labels[kind]} terbaca ${formatPeriod(candidates[0].layout.period)}. Pilih file untuk ${formatPeriod(period)}.`);
  }
  compatible.sort((a, b) => {
    const score = item => (item.layout.period === period ? 4 : 0) + exactSheetScore(item.name, kind);
    return score(b) - score(a);
  });
  if (compatible[0].layout.months?.size > 1) throw new Error(`Header tanggal di ${labels[kind]} memuat beberapa bulan.`);
  return compatible[0];
}

function parseCalendar(selected, kind) {
  const { rows, name, layout } = selected;
  const records = [];
  for (let index = layout.start; index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    const nik = idValue(row[layout.nik]);
    if (!nik || aliases.nik.has(headerKey(nik))) continue;
    const codes = Object.fromEntries(layout.columns.map(([day, col]) => [day, normalizeCode(valueOf(row[col]))]));
    records.push({
      nik, name: textValue(row[layout.name]) || nik, codes,
      fingerId: kind === 'absensi' ? idValue(row[layout.fingerId]) || nik : nik,
    });
  }
  if (!records.length) throw new Error(`${labels[kind]} belum memiliki baris karyawan dengan NIK.`);
  return { sheetName: name, rows: records };
}

function parseFinger(selected, period, date1904) {
  const { rows, name, layout } = selected;
  const index = createFingerIndex(period, name);
  for (let rowIndex = layout.start; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row) continue;
    const id = idValue(row[layout.nik]);
    const date = valueOf(row[layout.date]);
    const time = valueOf(row[layout.time]);
    const direction = headerKey(valueOf(row[layout.direction]));
    if ((!id && date === '' && time === '' && !direction) || aliases.nik.has(headerKey(id))) continue;
    recordScan(index, {
      id, date: asDate(date, date1904), seconds: asTime(time, layout.combined),
      direction: ['in', 'checkin'].includes(direction) ? 'IN' : ['out', 'checkout'].includes(direction) ? 'OUT' : '',
    });
  }
  return index;
}

function readWorkbook(bytes, filename) {
  const options = { dense: true, cellDates: false, cellHTML: false, cellFormula: false, raw: true };
  if (/\.csv$/i.test(filename)) {
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return read(decoded, { ...options, type: 'string' });
  }
  return read(bytes, { ...options, type: 'array' });
}

function uses1904(workbook) {
  return [true, 1, '1', 'true'].includes(workbook.Workbook?.WBProps?.date1904);
}

export function importAttendanceFile(bytes, filename, kind, period) {
  let workbook;
  try {
    workbook = readWorkbook(bytes, filename);
  } catch {
    throw new Error(`${labels[kind]} gagal dibaca. Gunakan file Excel atau CSV yang dapat dibuka.`);
  }
  const date1904 = uses1904(workbook);
  const selected = chooseSheet(workbook, kind, period, date1904);
  return kind === 'finger' ? parseFinger(selected, period, date1904) : parseCalendar(selected, kind);
}

export function importLeaveFile(bytes, filename) {
  let workbook;
  try {
    workbook = readWorkbook(bytes, filename);
  } catch {
    throw new Error('File Form Cuti gagal dibaca. Gunakan file Excel yang dapat dibuka.');
  }
  const sheetName = workbook.SheetNames.find(name => headerKey(name) === 'formcuti');
  const rows = workbook.Sheets[sheetName]?.['!data'] ?? [];
  const keys = ['nik', ...leaveOrder.flatMap(kind => [`${kind.toLowerCase()}mulai`, `${kind.toLowerCase()}selesai`])];
  const header = rows.slice(0, headerRows).findIndex(row => {
    const fields = row?.map(cell => headerKey(valueOf(cell))) ?? [];
    return keys.every(key => fields.includes(key));
  });
  if (header < 0) throw new Error('Kolom di sheet Form Cuti belum sesuai. Gunakan template dari aplikasi.');
  const fields = rows[header].map(cell => headerKey(valueOf(cell)));
  const date1904 = uses1904(workbook);
  const requests = [];
  for (let index = header + 1; index < rows.length; index++) {
    const row = rows[index];
    const field = name => row?.[fields.indexOf(name)];
    if (![...keys, 'nopengajuan', 'statuspengumpulan'].some(name => textValue(field(name)))) continue;
    try {
      const dates = Object.fromEntries(leaveOrder.map(kind => [kind, ['mulai', 'selesai'].map(end => {
        const cell = field(`${kind.toLowerCase()}${end}`);
        if (!textValue(cell)) return '';
        const date = cell?.t === 'e' ? null : asDate(valueOf(cell), date1904);
        if (!date) throw new Error(`Tanggal ${kind} ${end} belum valid.`);
        return date;
      })]));
      const status = normalizeCode(valueOf(field('statuspengumpulan')));
      if (status && !['SUDAH DIKUMPULKAN', 'BELUM DIKUMPULKAN', 'SUDAH', 'BELUM'].includes(status)) {
        throw new Error('Pilih status Sudah dikumpulkan atau Belum dikumpulkan.');
      }
      if (field('nik')?.t === 'e') throw new Error('NIK belum valid.');
      requests.push(leaveRequest(idValue(field('nik')), textValue(field('nopengajuan')), !status.startsWith('BELUM'), dates));
    } catch (error) {
      throw new Error(`Baris ${index + 1}. ${error.message}`);
    }
  }
  if (!requests.length) throw new Error('Isi setidaknya satu baris pengajuan di sheet Form Cuti.');
  return requests;
}
