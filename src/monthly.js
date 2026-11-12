import { expectedCode, isPermissionCode, validateAttendanceCell } from './audit.js';
import { daysInPeriod, formatClock } from './dates.js';

export const leaveTypes = ['CR', 'CT', 'CE'];
const requiredPermissions = new Set(['I', 'S', 'SL']);
const lateAfter = 7 * 3600 + 60;

export function coverageText(keys) {
  const dates = [...new Set(keys)].sort().map(date => Number(date.slice(8)));
  const ranges = [];
  for (const date of dates) {
    const last = ranges.at(-1);
    if (last && last[1] + 1 === date) last[1] = date;
    else ranges.push([date, date]);
  }
  return ranges.map(([start, end]) => start === end ? String(start) : `${start}–${end}`).join(', ');
}

export function totalsFor(employees) {
  const totals = { employees: employees.length, red: 0, yellow: 0, purple: 0, orange: 0, green: 0 };
  for (const employee of employees) {
    for (const cell of employee.cells) {
      if (cell.covered && Object.hasOwn(totals, cell.status)) totals[cell.status]++;
      if (cell.covered && cell.lateReason && cell.status !== 'orange') totals.orange++;
    }
  }
  return totals;
}

export function mergeMonthlyResult(month, batches) {
  const days = daysInPeriod(month.period);
  const indexByDate = new Map(days.map((day, index) => [day.key, index]));
  const employees = new Map();
  const roster = new Map((month.roster_rows ?? []).map(row => [row.nik, row]));
  const coveredDays = days.filter(day => month.coverage[day.key]).map(day => day.key);
  const sourceRanges = new Map();

  for (const { id, result } of batches) {
    const activeDays = result.days.flatMap((day, index) => month.coverage[day.key] === id && indexByDate.has(day.key)
      ? [[index, indexByDate.get(day.key)]] : []);
    if (!activeDays.length) continue;
    const sourceKeys = Object.keys(result.sources ?? {}).sort();
    if (sourceKeys.length) {
      const key = sourceKeys.join('+');
      if (!sourceRanges.has(key)) sourceRanges.set(key, { sources: sourceKeys, dates: [] });
      sourceRanges.get(key).dates.push(...activeDays.map(([, target]) => days[target].key));
    }
    // Older partial audits appended roster-only rows after the real Absensi rows.
    const attendanceRows = result.employees.slice(0, result.sources?.absensi?.rows ?? result.employees.length);
    for (const row of attendanceRows) {
      if (!employees.has(row.nik)) {
        const scheduled = roster.get(row.nik);
        const cells = days.map(day => {
          const rosterCode = scheduled?.codes[day.day] ?? '';
          return {
            code: '', rosterCode, expected: expectedCode(rosterCode, day.weekday), covered: false,
            firstIn: null, lastOut: null, status: 'empty', reason: '',
          };
        });
        employees.set(row.nik, { nik: row.nik, name: row.name || row.nik, fingerId: row.fingerId || row.nik, cells,
          nameFromRoster: sourceKeys.length > 0 && !sourceKeys.includes('absensi') });
      }
      const employee = employees.get(row.nik);
      if (employee.nameFromRoster && sourceKeys.includes('absensi')) {
        employee.name = row.name || row.nik;
        employee.nameFromRoster = false;
      }
      for (const [source, target] of activeDays) {
        employee.cells[target] = { ...row.cells[source], covered: true, fingerId: row.fingerId,
          sourceKeys: sourceKeys.length ? sourceKeys : undefined, checkId: id };
      }
    }
  }

  const rows = [...employees.values()];
  return {
    period: month.period, days, coveredDays, employees: rows, totals: totalsFor(rows),
    sources: batches[0]?.result.sources ?? {}, sourceRanges: [...sourceRanges.values()],
    rosterCalendar: sourceRanges.size > 0 && [...sourceRanges.values()].every(range => !range.sources.includes('absensi')),
    invalidFingerRows: batches.reduce((total, batch) => total + (batch.result.invalidFingerRows ?? 0), 0),
  };
}

export function applyGrades(result, grades) {
  if (!result) return null;
  const employees = result.employees.map(employee => ({ ...employee, gradeTwoUp: grades[employee.nik] === true,
    cells: employee.cells.map((cell, index) => validateAttendanceCell(cell, result.days[index],
      cell.sourceKeys ?? Object.keys(result.sources ?? {}), grades[employee.nik] === true)),
  }));
  return { ...result, employees, totals: totalsFor(employees) };
}

function indexByNik(rows) {
  const indexed = new Map();
  for (const row of rows) {
    if (!indexed.has(row.nik)) indexed.set(row.nik, []);
    indexed.get(row.nik).push(row);
  }
  return indexed;
}

function includesDate(form, date) {
  return form.start_date <= date && date <= form.end_date;
}

function compareLeave(code, forms) {
  if (!leaveTypes.includes(code) && !forms.length) return {};
  const formCode = [...new Set(forms.map(form => form.kind))].sort().join(' + ');
  const matching = forms.filter(form => form.kind === code);
  let leaveReason = '';
  if (forms.some(form => form.kind !== code)) leaveReason = `Absen ${code || 'kosong'}. Form Cuti ${formCode}.`;
  else if (!matching.length) leaveReason = `Form Cuti ${code} untuk tanggal ini belum tercatat.`;
  else if (!matching.some(form => form.collected)) leaveReason = `Form Cuti ${code} belum dikumpulkan.`;
  return { formCode, leaveReason };
}

function comparePermission(cell, permit) {
  const { code, reason, status } = cell;
  if (!permit && !requiredPermissions.has(code)) return {};
  if (!permit) return { permissionReason: `Izin ${code} belum dicatat.`, status: 'red' };
  if (permit.code !== code) return {
    permissionReason: `Absen ${code || 'kosong'}. Izin tercatat dengan kode ${permit.code}.`, status: 'red',
  };
  if (!permit.approved) return { permissionReason: `Izin ${code} menunggu persetujuan.`, status: 'red' };
  const issues = cell.issues ?? (reason ? [reason] : []);
  const remaining = issues.filter(issue => !isPermissionCode(code) || !/^(Seharusnya |Kode roster .* belum dipetakan\.|Kode absensi .* belum dikenali\.|ID belum ada di Tarikan Live Attendance\.|Ada catatan Live Attendance pada hari berkode tanpa kehadiran\.)/.test(issue));
  return {
    permissionReason: `Izin ${code} disetujui.`,
    reason: remaining.join(' '),
    status: remaining.length || (status === 'red' && !issues.length) ? 'red' : 'green',
  };
}

export function checkLeaveForms(result, forms = null, permissions = null) {
  if (!result) return null;
  const formsByNik = indexByNik(forms ?? []);
  const permissionsByNik = indexByNik(permissions ?? []);
  const employees = result.employees.map(employee => ({
    ...employee,
    cells: employee.cells.map((cell, index) => {
      if (!cell.covered) return cell;
      const date = result.days[index].key;
      const dateForms = (formsByNik.get(employee.nik) ?? []).filter(form => includesDate(form, date));
      const permission = (permissionsByNik.get(employee.nik) ?? []).find(row => row.permit_date === date);
      const hasAttendance = !cell.sourceKeys || cell.sourceKeys.includes('absensi');
      const shortLeavePermission = ['CT', 'CE'].includes(cell.code) && permission?.code === cell.code && !dateForms.length;
      const leave = forms === null || shortLeavePermission || !hasAttendance ? {} : compareLeave(cell.code, dateForms);
      const permit = permissions === null || !hasAttendance ? {} : comparePermission(cell, permission);
      const updated = { ...cell, ...leave, ...permit };
      if (leave.leaveReason) updated.status = 'red';
      if (cell.status === 'purple') Object.assign(updated, { status: 'purple', reason: cell.reason });
      if (hasAttendance && cell.code === 'D3' && Number.isInteger(cell.firstIn) && cell.firstIn > lateAfter) {
        updated.lateReason = `Terlambat. Live Attendance In pukul ${formatClock(cell.firstIn)}.`;
        if (updated.status === 'normal') updated.status = 'orange';
      }
      return updated;
    }),
  }));
  return { ...result, employees, totals: totalsFor(employees) };
}

export function formAttendanceReview(form, result, forms, permissions = []) {
  const waiting = { tone: 'uncovered', message: 'Menunggu data Absen pada tanggal pengajuan.' };
  if (!result) return waiting;
  const employee = result.employees.find(row => row.nik === form.nik);
  const covered = result.sourceRanges?.length ? result.sourceRanges.filter(range => range.sources.includes('absensi')).flatMap(range => range.dates)
    : result.coveredDays ?? result.days.filter(day => day.key >= result.start && day.key <= result.end).map(day => day.key);
  const checked = new Set(covered);
  const dates = result.days.flatMap((day, index) => includesDate(form, day.key) ? [index] : []);
  if (!employee) {
    return dates.some(index => checked.has(result.days[index].key))
      ? { tone: 'red', message: 'NIK belum tercatat di Absen pada rentang yang sudah diperiksa.' } : waiting;
  }
  const coveredByAttendance = cell => cell?.covered && (!cell.sourceKeys || cell.sourceKeys.includes('absensi'));
  const inspected = dates.filter(index => coveredByAttendance(employee.cells[index]));
  if (!inspected.length) return waiting;
  const differences = inspected.filter(index => employee.cells[index].code !== form.kind);
  const outside = [];
  const otherForms = forms.filter(row => row.nik === form.nik && row.kind === form.kind);
  const approvedDays = new Set(['CT', 'CE'].includes(form.kind) ? permissions.filter(row => row.nik === form.nik && row.code === form.kind && row.approved)
    .map(row => row.permit_date) : []);
  const isMatching = index => coveredByAttendance(employee.cells[index]) && employee.cells[index].code === form.kind;
  // Compare contiguous days before and after the declared dates without counting dates from another request twice.
  for (const [boundary, step] of [[dates[0], -1], [dates.at(-1), 1]]) {
    if (!isMatching(boundary)) continue;
    for (let index = boundary + step; isMatching(index); index += step) {
      const date = result.days[index].key;
      if (!approvedDays.has(date) && !otherForms.some(row => includesDate(row, date))) outside.push(date);
    }
  }
  const messages = [];
  if (differences.length) {
    const first = differences[0];
    messages.push(`Periksa tanggal ${coverageText(differences.map(index => result.days[index].key))}. Absen tanggal ${result.days[first].day} ${employee.cells[first].code || 'kosong'}, Form Cuti ${form.kind}.`);
  }
  if (outside.length) messages.push(`Form Cuti ${form.kind} perlu mencakup tanggal ${coverageText(outside)} sesuai Absen.`);
  return messages.length ? { tone: 'red', message: messages.join(' ') } : { tone: 'green', message: 'Sesuai pada tanggal yang sudah diperiksa.' };
}
