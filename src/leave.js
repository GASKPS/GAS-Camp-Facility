import { normalizeCode } from './audit.js';
import { validDate } from './dates.js';
import { leaveTypes } from './monthly.js';

export const leaveTemplate = 'Template_Form_Cuti.xlsx';
export const leaveLabels = { CR: 'Cuti roster', CT: 'Cuti tahunan', CE: 'Cuti extra' };
export const leaveOrder = ['CR', 'CE', 'CT'];

export function leaveRequest(nik, number, collected, datePairs) {
  nik = normalizeCode(nik);
  if (!nik) throw new Error('Isi NIK karyawan.');
  const segments = leaveOrder.flatMap(kind => {
    const [start_date, end_date] = datePairs[kind] ?? [];
    if (!start_date && !end_date) return [];
    if (!validDate(start_date) || !validDate(end_date) || end_date < start_date) {
      throw new Error(`Isi tanggal mulai dan selesai ${kind} dengan urutan yang valid.`);
    }
    return [{ kind, start_date, end_date }];
  });
  if (!segments.length) throw new Error('Isi setidaknya satu rentang CR, CE, atau CT.');
  return { nik, request_no: String(number ?? '').trim(), collected, segments };
}

export function leaveSegments(requests) {
  return requests.flatMap(request => request.segments.filter(segment => leaveTypes.includes(segment.kind))
    .map(segment => ({ ...segment, nik: request.nik, collected: request.collected })));
}

export function legacyLeaveRequest({ id, nik, kind, start_date, end_date, collected }) {
  return { id, nik, collected, request_no: '', segments: [{ kind, start_date, end_date }] };
}
