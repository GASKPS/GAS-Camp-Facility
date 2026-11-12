const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const weekdayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const monthFormatter = new Intl.DateTimeFormat('id-ID', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
});

export function dateKey(year, month, day) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function validDate(value) {
  const match = datePattern.exec(value ?? '');
  return match ? dateKey(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function daysInPeriod(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '') || !validDate(`${period}-01`)) return [];
  const [year, month] = period.split('-').map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => {
    const day = index + 1;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { day, key: dateKey(year, month, day), weekday, label: weekdayNames[weekday] };
  });
}

export function currentPeriod() {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', timeZone: 'Asia/Jayapura',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}`;
}

export function formatDate(key) {
  return validDate(key) ? dateFormatter.format(new Date(`${key}T00:00:00Z`)) : '—';
}

export function formatPeriod(period) {
  return validDate(`${period}-01`) ? monthFormatter.format(new Date(`${period}-01T00:00:00Z`)) : '—';
}

export function formatClock(seconds) {
  if (!Number.isInteger(seconds)) return '—';
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

export function validCoverage({ period, start, end }) {
  return Boolean(validDate(start) && validDate(end) && start.slice(0, 7) === period
    && end.slice(0, 7) === period && start <= end);
}
