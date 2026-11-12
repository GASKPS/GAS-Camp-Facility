import calendar from 'lucide-static/icons/calendar-days.svg?raw';
import fingerprint from 'lucide-static/icons/fingerprint.svg?raw';
import sheet from 'lucide-static/icons/sheet.svg?raw';
import clipboard from 'lucide-static/icons/clipboard-check.svg?raw';
import upload from 'lucide-static/icons/upload.svg?raw';
import logout from 'lucide-static/icons/log-out.svg?raw';
import settings from 'lucide-static/icons/settings-2.svg?raw';
import eye from 'lucide-static/icons/eye.svg?raw';
import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
import alert from 'lucide-static/icons/circle-alert.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import close from 'lucide-static/icons/x.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import arrow from 'lucide-static/icons/arrow-right.svg?raw';
import lock from 'lucide-static/icons/lock-keyhole.svg?raw';
import users from 'lucide-static/icons/users-round.svg?raw';
import clock from 'lucide-static/icons/clock-3.svg?raw';
import history from 'lucide-static/icons/history.svg?raw';
import download from 'lucide-static/icons/download.svg?raw';
import { daysInPeriod, formatClock, formatDate, formatPeriod } from './dates.js';
import { appName, sourceNames } from './labels.js';
import { coverageText, formAttendanceReview, leaveTypes } from './monthly.js';
import { leaveLabels, leaveOrder, leaveSegments, leaveTemplate } from './leave.js';

const icons = { calendar, fingerprint, sheet, clipboard, upload, logout, settings, eye, eyeOff, alert, check, close, search, arrow, lock, users, clock, history, download };
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const savedDateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jayapura' });
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const missingAttendance = 'Satu catatan Live Attendance kosong';
const watermark = '<span class="watermark">GA service camp &amp; facility</span>';

const rosterPreview = [
  ['Arif Pratama', 'CR CR CR CR CR CR CR CR D2 D3'],
  ['Nadia Putri', 'D3 D2 D3 D3 D3 D3 D3 D3 D2 D3'],
  ['Dewi Lestari', 'D3 D2 L D3 D3 D3 D3 D3 D2 D3', 6],
  ['Rangga Saputra', 'L CR CR CR CR CR CR CR CR CR'],
  ['Nisa Ramadhani', 'D3 D2 D3 D3 L D3 D3 D3 D2 D3'],
  ['Bima Wibowo', 'D3 D2 D3 D3 D3 D3 D3 D3 D2 D3', 6],
];

export const sources = [
  { key: 'finger', name: sourceNames.finger, icon: 'fingerprint', color: 'violet', caption: 'NIK mesin, tanggal, jam, dan In/Out', example: 'Live-Attendance-contoh.xlsx', template: 'Template_Tarikan_Live_Attendance.xlsx' },
  { key: 'roster', name: sourceNames.roster, icon: 'calendar', color: 'mint', caption: 'Jadwal karyawan per tanggal', example: 'Roster-contoh.xlsx', template: 'Template_Roster.xlsx' },
  { key: 'absensi', name: sourceNames.absensi, icon: 'sheet', color: 'blue', caption: 'Kode absensi per NIK dan tanggal', example: 'Absensi-contoh.xlsx', template: 'Template_Absensi.xlsx' },
];

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
export const icon = (name, extra = '') => `<span class="icon ${extra}" aria-hidden="true">${icons[name]}</span>`;
export const disabled = condition => condition ? ' disabled' : '';

export function brand(extra = '') {
  return `<div class="brand ${extra}"><span class="brand-mark">${icon('clipboard')}</span><span>${appName}</span></div>`;
}

function calendarIllustration() {
  return `<section class="illustration" aria-label="Cuplikan kalender roster">
    <div class="illustration-head">
      <span class="illustration-icon">${icon('calendar')}</span>
      <div><strong>Kalender roster</strong><small>Cuplikan kehadiran</small></div>
      <span class="illustration-count">2 peringatan</span>
    </div>
    <div class="illustration-scroll" tabindex="0"><table class="illustration-table" aria-label="Nama karyawan dan kode kehadiran">
      <tbody>${rosterPreview.map(([name, codes, warning]) => `<tr><th scope="row">${escape(name)}</th>${codes.split(' ').map((code, index) => `<td${index === warning ? ' class="illustration-yellow"' : ''}>${escape(code)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="illustration-key"><span><i class="dot yellow"></i> ${missingAttendance}</span></div>
  </section>`;
}

export function loginView(state) {
  const canSignIn = Boolean(state.config) && !state.authBusy;
  return `<main class="login-shell">
    <aside class="login-visual">
      ${brand('brand-light')}
      <div class="login-visual-content">
        <h1>Pemeriksaan<br>absensi</h1>
        <p>Cocokkan roster, absensi, dan Live Attendance dalam satu kalender.</p>
        ${calendarIllustration()}
      </div>
      <footer class="login-footer"><div class="login-privacy">${icon('lock')} File dan hasil tersimpan secara privat di Supabase.</div>${watermark}</footer>
    </aside>
    <section class="login-main" aria-labelledby="login-title">
      <div class="login-card">
        ${brand('brand-mobile')}
        <span class="login-mark">${icon('lock')}</span>
        <h2 id="login-title">Masuk ke ${appName}</h2>
        <p class="muted login-description">Gunakan email dan kata sandi akun yang dibuat di proyek Supabase Anda.</p>
        <form id="login-form" class="login-form">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" placeholder="nama@perusahaan.com" value="${escape(state.email)}" autocomplete="username" required${disabled(state.authBusy)}>
          <label for="password">Kata sandi</label>
          <div class="password-field">
            <input type="password" id="password" name="password" autocomplete="current-password" placeholder="Masukkan kata sandi" required${disabled(state.authBusy)}>
            <button type="button" class="icon-button password-toggle" data-action="password" aria-label="Tampilkan kata sandi">${icon('eye')}${icon('eyeOff', 'password-hidden')}</button>
          </div>
          ${state.authError ? `<p class="notice error" role="alert">${icon('alert')}${escape(state.authError)}</p>` : ''}
          <button class="button primary login-button" type="submit"${disabled(!canSignIn)}>${state.authBusy ? '<span class="spinner"></span> Memeriksa akun…' : `Masuk ${icon('arrow')}`}</button>
        </form>
        ${!state.fixedConfig ? `<div class="project-link">${icon('settings')}<div><strong>${state.config ? escape(new URL(state.config.url).hostname) : 'Hubungkan proyek Supabase'}</strong><span>${state.config ? 'Proyek untuk login pada browser ini' : 'Isi Project URL dan Publishable Key untuk mengaktifkan login.'}</span></div><button type="button" class="text-button" data-action="project"${disabled(state.authBusy)}>Atur</button></div>` : ''}
        <button type="button" class="button secondary demo-button" data-action="demo"${disabled(state.authBusy)}>${icon('calendar')} Lihat data contoh</button>
      </div>
    </section>
    <dialog id="project-dialog" aria-labelledby="project-title"></dialog>
  </main>`;
}

export function projectDialog(config) {
  return `<div class="dialog-head"><div><h2 id="project-title">Hubungkan Supabase</h2><p class="muted">Salin Project URL dan Publishable Key dari proyek Supabase.</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div>
    <form id="project-form" class="project-form">
      <label for="project-url">Project URL</label>
      <input id="project-url" name="url" type="url" placeholder="https://nama-proyek.supabase.co" value="${escape(config?.url)}" required>
      <label for="project-key">Publishable Key</label>
      <input id="project-key" name="key" type="text" placeholder="sb_publishable_…" value="${escape(config?.key)}" spellcheck="false" autocomplete="off" required>
      <p class="notice error" id="project-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="button secondary" data-action="close-dialog">Batal</button><button type="submit" class="button primary">Simpan</button></div>
    </form>`;
}

function fileSize(size) {
  return size >= 1024 * 1024 ? `${numberFormat.format(size / (1024 * 1024))} MB` : `${numberFormat.format(size / 1024)} KB`;
}

function uploadCard(source, state) {
  const storedRoster = source.key === 'roster' && state.month?.roster_id;
  const file = storedRoster ? state.month.roster_file : state.files[source.key];
  const name = state.demo ? source.example : file?.name;
  const imported = state.result?.sources[source.key];
  const metadata = storedRoster ? 'Roster bulan ini tersimpan' : imported && state.demo
    ? `${numberFormat.format(imported.rows)} baris dibaca` : file ? fileSize(file.size) : '';
  const locked = state.demo || state.pendingSave || state.saving || state.busy || storedRoster;
  const downloadButton = `<button type="button" class="icon-button" data-action="download" data-kind="${source.key}" aria-label="Unduh ${source.name}" title="Unduh ${source.name}"${disabled(state.downloading)}>${state.downloading === source.key ? '<span class="spinner"></span>' : icon('download')}</button>`;
  return `<article class="upload-card" data-drop="${source.key}">
    <div class="upload-heading">
      <span class="source-icon ${source.color}">${icon(source.icon)}</span>
      <div><h3>${source.name}</h3><p>${source.caption}</p></div>
      ${name ? `<span class="source-check" aria-label="File dipilih">${icon('check')}</span>` : ''}
    </div>
    <input id="file-${source.key}" data-file="${source.key}" type="file" accept=".xlsx,.xls,.csv" hidden${disabled(locked)}>
    ${name ? `<div class="file-selected"><div class="file-meta"><span title="${escape(name)}">${escape(name)}</span><small>${escape(metadata)}</small></div>
      ${storedRoster ? downloadButton : locked ? '' : `<button type="button" class="icon-button" data-action="remove-file" data-kind="${source.key}" aria-label="Hapus ${source.name}">${icon('close')}</button>`}</div>`
    : `<button class="dropzone" type="button" data-action="choose-file" data-kind="${source.key}"${disabled(locked)}>${icon('upload')} <span><strong>Pilih file</strong><small>Excel atau CSV</small></span></button>`}
    <a class="template-link" href="${import.meta.env.BASE_URL}templates/${source.template}" download="${source.template}" aria-label="Unduh template Excel ${source.name}">${icon('download')} Unduh template Excel</a>
  </article>`;
}

function stat(iconName, label, value, color, filter, active) {
  return `<button type="button" class="stat-card" data-action="filter-warning" data-filter="${filter}" aria-pressed="${filter === active}">
    <span class="stat-icon ${color}">${icon(iconName)}</span><span class="stat-value"><span>${label}</span><strong>${numberFormat.format(value)}</strong></span>
  </button>`;
}

function coverageLabel(result) {
  if (result.coveredDays) return coverageText(result.coveredDays);
  return result.start === result.end ? formatDate(result.end) : `${Number(result.start.slice(8))}–${formatDate(result.end)}`;
}

function savedAt(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? savedDateFormat.format(time) : '—';
}

const activityLabels = {
  upload: 'Unggah absensi', correction: 'Koreksi absensi',
  review: 'Sudah dicek', undo_review: 'Batalkan tanda sudah dicek',
};

function activityRow(row) {
  const dates = row.start_date === row.end_date ? formatDate(row.start_date) : `${formatDate(row.start_date)} – ${formatDate(row.end_date)}`;
  return `<li class="history-item activity-item">
    <div><strong>${escape(activityLabels[row.action])}</strong><p>${escape(dates)}${row.nik ? ` · NIK ${escape(row.nik)}` : ''}</p>
      ${row.corrected_dates?.length ? `<p>Koreksi tanggal ${escape(coverageText(row.corrected_dates))}</p>` : ''}
    </div><div class="activity-actor"><strong>${escape(row.actor_email)}</strong><p>${escape(savedAt(row.occurred_at))} WIT</p></div>
  </li>`;
}

export function historyDialog({ tab, archives, activity, teamName }) {
  const showActivity = tab === 'activity';
  const { rows, more, loading, error } = showActivity ? activity : archives;
  return `<div class="dialog-head"><div><h2 id="history-title">Riwayat</h2><p class="muted">${escape(teamName)}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div>
    <nav class="history-tabs" aria-label="Jenis riwayat">
      ${[['archives', 'Arsip bulanan'], ['activity', 'Jejak perubahan']].map(([key, name]) =>
        `<button type="button" class="button ${key === tab ? 'primary' : 'secondary'}" data-action="history-tab" data-tab="${key}" aria-pressed="${key === tab}">${name}</button>`).join('')}
    </nav>
    ${error ? `<p class="notice error" role="alert">${icon('alert')}${escape(error)}</p>` : ''}
    ${rows.length ? `<ul class="history-list">${showActivity ? rows.map(activityRow).join('') : rows.map(row => `<li class="history-item">
      <div><strong>${escape(formatPeriod(row.period))}</strong><p>Diperiksa ${escape(coverageText(Object.keys(row.coverage)))}</p>
      <p>Disimpan ${escape(savedAt(row.updated_at))} WIT</p></div>
      <button type="button" class="button secondary history-button" data-action="open-check" data-period="${escape(row.period)}"${disabled(loading)}>Buka hasil ${icon('arrow')}</button>
    </li>`).join('')}</ul>` : ''}
    ${loading ? '<p class="notice progress" role="status"><span class="spinner"></span> Memuat…</p>' : ''}
    ${!rows.length && !loading && !error ? `<p class="history-empty muted">${showActivity ? 'Unggahan dan pemeriksaan yang disimpan akan muncul di sini.' : 'Arsip bulanan akan muncul setelah pemeriksaan disimpan.'}</p>` : ''}
    ${!loading && (more || error) ? `<div class="dialog-actions"><button type="button" class="button secondary" data-action="load-history">${error ? 'Coba lagi' : 'Muat lagi'}</button></div>` : ''}`;
}

export function filesDialog(month, batches) {
  return `<div class="dialog-head"><div><h2 id="files-title">File per rentang</h2><p class="muted">${escape(formatPeriod(month.period))}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div>
    <p class="notice error" id="file-download-error" role="alert" hidden></p>
    ${month.roster_id ? `<button type="button" class="button secondary" data-action="download" data-kind="roster">${icon('download')} Roster bulanan</button>` : ''}
    <ul class="history-list">${batches.map(batch => {
      const dates = Object.keys(month.coverage).filter(key => month.coverage[key] === batch.id);
      return `<li class="history-item file-archive"><div><strong>Tarikan ${escape(coverageLabel({ start: batch.scan_start, end: batch.scan_end }))}</strong><p>Tanggal yang memakai file ini ${escape(coverageText(dates))}</p></div>
        <div class="file-archive-links">${sources.filter(source => batch.source_files[source.key] && source.key !== 'roster').map(source => `<button type="button" class="button secondary history-button" data-action="download" data-kind="${source.key}" data-batch="${escape(batch.id)}" title="${escape(batch.source_files[source.key].name)}">${icon('download')} ${source.name}</button>`).join('')}</div></li>`;
    }).join('')}</ul>`;
}

function employeeField(entry, busy) {
  return `<label>NIK karyawan<input id="form-nik" name="nik" value="${escape(entry.nik)}" list="leave-employees" required${disabled(busy)}></label>`;
}

function editorActions(entry, tab, busy, label) {
  return `<div class="leave-actions">${entry.id ? `<button type="button" class="button secondary" data-action="leave-tab" data-tab="${tab}"${disabled(busy)}>Batal</button>` : ''}<button type="submit" class="button primary"${disabled(busy)}>${entry.id ? 'Simpan perubahan' : label}</button></div>`;
}

function leaveFields(entry, grouped, busy) {
  const dates = (prefix, segment, required = '') => `<label>Mulai<input type="date" name="${prefix}start_date" value="${escape(segment.start_date)}"${required}${disabled(busy)}></label>
    <label>Selesai<input type="date" name="${prefix}end_date" value="${escape(segment.end_date)}"${required}${disabled(busy)}></label>`;
  const segment = entry.segments?.[0] ?? {};
  return `<form id="leave-form" class="leave-form">
    ${employeeField(entry, busy)}
    ${grouped
      ? `<label>No. pengajuan (opsional)<input name="request_no" value="${escape(entry.request_no)}"${disabled(busy)}></label>
        <div class="leave-date-grid">${leaveOrder.map(kind => `<fieldset><legend>${leaveLabels[kind]} · ${kind}</legend>${dates(`${kind}-`, entry.segments?.find(row => row.kind === kind) ?? {})}</fieldset>`).join('')}</div>`
      : `<label>Jenis cuti<select name="kind" required${disabled(busy)}><option value="">Pilih jenis</option>${leaveTypes.map(kind => `<option value="${kind}"${kind === segment.kind ? ' selected' : ''}>${kind}</option>`).join('')}</select></label>
        ${dates('', segment, ' required')}`}
    <label>Status pengumpulan<select name="collected"${disabled(busy)}><option value="yes">Sudah dikumpulkan</option><option value="no"${entry.collected === false ? ' selected' : ''}>Belum dikumpulkan</option></select></label>
    ${editorActions(entry, 'leave', busy, 'Simpan form')}
  </form>`;
}

function permissionFields(entry, busy) {
  return `<form id="permission-form" class="leave-form">
    ${employeeField(entry, busy)}
    <label>Kode di Absen<input name="code" value="${escape(entry.code)}" list="permission-codes" required${disabled(busy)}></label>
    <datalist id="permission-codes"><option value="I">Izin</option><option value="S">Sakit di Site</option><option value="SL"></option><option value="CT">Izin potong cuti tahunan</option><option value="CE">Izin potong cuti extra</option></datalist>
    <label>Tanggal izin<input type="date" name="permit_date" value="${escape(entry.permit_date)}" required${disabled(busy)}></label>
    <label>Persetujuan<select name="approved"${disabled(busy)}><option value="no">Menunggu persetujuan</option><option value="yes"${entry.approved ? ' selected' : ''}>Disetujui</option></select></label>
    ${editorActions(entry, 'permission', busy, 'Simpan izin')}
  </form>`;
}

function rowActions(row, type, busy, editable) {
  if (!editable) return '';
  return `<div class="leave-item-actions">
    ${type === 'permission' && !row.approved ? `<button type="button" class="button secondary history-button" data-action="approve-permission" data-id="${escape(row.id)}"${disabled(busy)}>Setujui</button>` : ''}
    <button type="button" class="button secondary history-button" data-action="edit-${type}" data-id="${escape(row.id)}"${disabled(busy)}>Ubah</button>
    <button type="button" class="text-button leave-delete" data-action="delete-${type}" data-id="${escape(row.id)}"${disabled(busy)}>Hapus</button></div>`;
}

function leaveList(state, names, busy) {
  const forms = leaveSegments(state.leaveRequests);
  return state.leaveRequests.length ? `<ul class="history-list leave-list">${state.leaveRequests.map(request => {
    const segments = request.segments.map(segment => ({ ...segment,
      review: formAttendanceReview({ ...segment, nik: request.nik }, state.baseResult, forms, state.permissions ?? []),
    }));
    const warning = !request.collected || segments.some(segment => segment.review.tone === 'red');
    return `<li class="history-item leave-item ${warning ? 'form-warning' : ''}"><div>
      <strong>${escape(names.get(request.nik) || request.nik)}</strong>
      <p>${escape(request.nik)}${request.request_no ? ` · ${escape(request.request_no)}` : ''}</p>
      <span class="history-badge ${request.collected ? 'mint' : 'red'}">${request.collected ? 'Sudah dikumpulkan' : 'Belum dikumpulkan'}</span>
      <ul class="leave-segments">${segments.map(segment => {
        const range = segment.start_date === segment.end_date ? formatDate(segment.start_date)
          : `${formatDate(segment.start_date)} – ${formatDate(segment.end_date)}`;
        return `<li><strong>${segment.kind}</strong> <span>${escape(range)}</span><p class="${segment.review.tone === 'red' ? 'leave-warning' : ''}">${escape(segment.review.message)}</p></li>`;
      }).join('')}</ul>
    </div>${rowActions(request, 'leave', busy, state.team?.editable)}</li>`;
  }).join('')}</ul>` : '<p class="history-empty muted">Belum ada Form Cuti untuk periode ini.</p>';
}

function permissionList(state, names, busy) {
  return state.permissions.length ? `<ul class="history-list leave-list">${state.permissions.map(row => {
    const dayIndex = state.baseResult?.days.findIndex(day => day.key === row.permit_date);
    const cell = state.baseResult?.employees.find(employee => employee.nik === row.nik)?.cells[dayIndex];
    const mismatch = cell?.covered && cell.code !== row.code;
    return `<li class="history-item leave-item ${mismatch || !row.approved ? 'form-warning' : ''}"><div>
      <strong>${escape(names.get(row.nik) || row.nik)} · ${escape(row.code)}</strong>
      <p>${escape(row.nik)} · ${escape(formatDate(row.permit_date))}</p>
      <span class="history-badge ${row.approved ? 'mint' : 'red'}">${row.approved ? 'Disetujui' : 'Menunggu persetujuan'}</span>
      ${mismatch ? `<p class="leave-warning">Absen ${escape(cell.code || 'kosong')}. Izin ${escape(row.code)}.</p>` : ''}
    </div>${rowActions(row, 'permission', busy, state.team?.editable)}</li>`;
  }).join('')}</ul>` : '<p class="history-empty muted">Belum ada izin untuk periode ini.</p>';
}

export function leavePage(state, { tab, entry, error, notice, busy }) {
  const permitted = state.permissions !== null;
  const ready = state.leaveRequests !== null;
  const permissionTab = tab === 'permission';
  const names = new Map((state.month?.roster_rows ?? []).map(row => [row.nik, row.name]));
  for (const employee of state.baseResult?.employees ?? []) names.set(employee.nik, employee.name);
  const loadError = state.monthError || state.leaveError;
  return `<main class="dashboard leave-page">
      <button type="button" class="text-button back-link" data-action="back-dashboard">← Kembali ke Kalender Hasil</button>
      <section class="dashboard-intro">
        <div><h1>Form Cuti</h1><p>Cocokkan pengajuan cuti dan izin dengan kode serta tanggal di Absen.</p></div>
        <div class="period-field"><label for="form-period">Periode absensi</label><input id="form-period" type="month" name="period" min="${escape(state.retentionPeriod)}" value="${escape(state.period)}"${disabled(busy || state.demo || state.pendingSave || state.saving)}></div>
      </section>
      ${state.monthStatus === 'loading' ? '<p class="notice progress" role="status"><span class="spinner"></span> Memuat Form Cuti dan izin…</p>' : ''}
      ${loadError ? `<div class="notice error" role="alert">${icon('alert')}<span>${escape(loadError)}</span><button type="button" class="text-button" data-action="refresh-month">Muat ulang</button></div>` : ''}
      <nav class="leave-tabs" aria-label="Jenis pengajuan">
        ${[['leave', 'Form Cuti'], ['permission', 'Izin dan sakit']].map(([key, label]) => `<button type="button" class="button ${key === tab ? 'primary' : 'secondary'}" data-action="leave-tab" data-tab="${key}" aria-pressed="${key === tab}"${disabled(busy)}>${label}</button>`).join('')}
      </nav>
      ${busy ? '<p class="notice progress" role="status"><span class="spinner"></span> Menyimpan perubahan…</p>' : ''}
      ${error ? `<p class="notice error" role="alert">${icon('alert')}${escape(error)}</p>` : ''}
      ${notice ? `<p class="notice saved" role="status">${icon('check')}${escape(notice)}</p>` : ''}
      <datalist id="leave-employees">${[...names].map(([nik, name]) => `<option value="${escape(nik)}">${escape(name)}</option>`).join('')}</datalist>
      ${state.team?.editable ? `<section class="management-card">
        <div class="section-heading"><h2>${entry?.id ? 'Ubah pengajuan' : permissionTab ? 'Catat izin atau sakit' : 'Tambah pengajuan cuti'}</h2>
        ${permissionTab ? '' : `<div class="dashboard-actions">
          <a class="button secondary" href="${import.meta.env.BASE_URL}templates/${leaveTemplate}" download>${icon('download')} Template Excel</a>
          <input id="leave-upload" type="file" accept=".xlsx" hidden>
          <button type="button" class="button primary" data-action="choose-leave-file"${disabled(busy || !ready || !permitted)}>${icon('upload')} Unggah Excel</button>
        </div>`}</div>
        ${permissionTab
          ? permitted ? permissionFields(entry ?? {}, busy) : '<p class="muted leave-hint">Pencatatan izin tersedia setelah pembaruan database.</p>'
          : ready ? leaveFields(entry ?? {}, permitted, busy) : ''}
      </section>` : ''}
      ${ready && (!permissionTab || permitted) ? `<section class="management-card"><div class="section-heading"><h2>${permissionTab ? 'Daftar izin' : 'Daftar pengajuan'}</h2><span>${escape(formatPeriod(state.period))}</span></div>
        ${permissionTab ? permissionList(state, names, busy) : leaveList(state, names, busy)}
      </section>` : ''}
      <footer class="dashboard-footer">${watermark}</footer>
    </main>`;
}

function checkMessage(cell) {
  if (!cell.covered) return 'Belum diperiksa.';
  const reason = String(cell.reason ?? '').replace(/tarikan finger/gi, sourceNames.finger)
    .replace(/ID Finger/gi, 'ID Live Attendance').replace(/\bscan\b/gi, 'Live Attendance');
  const notes = [cell.reviewed ? 'Sudah dicek.' : '', reason, cell.leaveReason, cell.permissionReason, cell.lateReason, cell.offReason].filter(Boolean);
  if (notes.length) return notes.join(' ');
  if (!cell.code) return 'Belum ada kode absensi pada tanggal ini.';
  return 'Sesuai.';
}

function checkTone(cell) {
  if (!cell.covered) return 'uncovered';
  if (['red', 'yellow', 'purple', 'orange', 'green'].includes(cell.status)) return cell.status;
  return cell.code ? 'normal' : 'uncovered';
}

function checkClass(cell) {
  return checkTone(cell) + (cell.lateReason && cell.status !== 'orange' ? ' also-late' : '');
}

function attendanceLegend(includeUncovered) {
  return `<span><i class="dot red"></i> Perlu dicek</span><span><i class="dot yellow"></i> ${missingAttendance}</span><span><i class="dot purple"></i> In dan Out kosong</span><span><i class="dot orange"></i> Terlambat</span><span><i class="dot green"></i> Sudah dicek atau izin disetujui</span>${includeUncovered ? '<span><i class="dot uncovered"></i> Belum diperiksa</span>' : ''}`;
}

function matchesWarning(cell, filter) {
  if (!filter) return true;
  return Boolean(cell?.covered && (cell.status === filter || (filter === 'orange' && cell.lateReason)));
}

export function calendarContent(result, query = '', filter = '') {
  const search = query.trim().toLowerCase();
  const employees = result.employees.map((employee, index) => ({ employee, index })).filter(({ employee }) =>
    (!search || employee.nik.toLowerCase().includes(search) || employee.name.toLowerCase().includes(search))
    && (!filter || employee.cells.some(cell => matchesWarning(cell, filter))));
  const columns = result.days.map((day, index) => ({ day, index })).filter(({ index }) =>
    !filter || employees.some(({ employee }) => matchesWarning(employee.cells[index], filter)));
  const rows = employees.map(({ employee, index }) => `<tr>
    <th scope="row" class="employee-cell"><button type="button" class="employee-name" data-action="employee-calendar" data-row="${index}" title="Kalender ${escape(employee.name)}"><strong>${escape(employee.name)}</strong><small>${escape(employee.nik)}</small></button></th>
    ${columns.map(({ day, index: column }) => {
      const cell = employee.cells[column];
      if (!matchesWarning(cell, filter)) return '<td></td>';
      const label = `${employee.name}, ${formatDate(day.key)}. ${checkMessage(cell)}`;
      return `<td><button type="button" class="day-cell ${checkClass(cell)}" data-action="detail" data-row="${index}" data-day="${column}" aria-label="${escape(label)}">${escape(cell.code || '·')}</button></td>`;
    }).join('')}
  </tr>`).join('');
  return `<thead><tr><th scope="col" class="employee-cell">Karyawan <small>Nama dan NIK</small></th>
    ${columns.map(({ day }) => `<th scope="col" class="${day.weekday === 5 ? 'friday' : ''}"><strong>${day.day}</strong><small>${day.label}</small></th>`).join('')}
  </tr></thead><tbody id="calendar-body">${rows || `<tr><td colspan="${columns.length + 1}" class="calendar-empty-row">${filter ? 'Tidak ada peringatan untuk filter ini.' : 'Karyawan tidak ditemukan.'}</td></tr>`}</tbody>`;
}

function sourceNotice(result) {
  const ranges = result.sourceRanges ?? [{ sources: Object.keys(result.sources), dates: result.days.filter(day => day.key >= result.start && day.key <= result.end).map(day => day.key) }];
  return ranges.map(range => {
    const labels = ['absensi', 'roster', 'finger'].filter(key => range.sources.includes(key)).map(key => sourceNames[key]);
    return `<span>${ranges.length > 1 ? `Tanggal ${escape(coverageText(range.dates))} · ` : ''}${escape(labels.join(' + '))}</span>`;
  }).join('');
}

function resultPanel(state) {
  const result = state.result;
  if (!result) {
    if (state.monthStatus === 'loading') return '';
    return `<section class="results-empty" aria-label="Kalender hasil"><span class="empty-icon">${icon('calendar')}</span><h2>Belum ada absensi</h2><p>${state.team?.editable ? 'Unggah dua atau tiga file untuk mulai memeriksa Sub Departemen ini.' : 'Arsip akan tampil setelah Admin menyimpan hasil pemeriksaan.'}</p></section>`;
  }
  return `<section id="results" class="result-area" tabindex="-1" aria-labelledby="result-title">
    <div class="stats">
      ${stat('users', 'Semua karyawan', result.totals.employees, 'violet', '', state.warningFilter)}
      ${stat('alert', 'Perlu dicek', result.totals.red, 'rose', 'red', state.warningFilter)}
      ${stat('clock', 'Satu catatan kosong', result.totals.yellow, 'amber', 'yellow', state.warningFilter)}
      ${stat('fingerprint', 'In dan Out kosong', result.totals.purple ?? 0, 'violet', 'purple', state.warningFilter)}
      ${stat('clock', 'Terlambat', result.totals.orange ?? 0, 'peach', 'orange', state.warningFilter)}
    </div>
    ${result.invalidFingerRows ? `<div class="notice review">${icon('alert')} ${numberFormat.format(result.invalidFingerRows)} baris Live Attendance memiliki ID, tanggal, jam, atau arah yang perlu dicek.</div>` : ''}
    <section class="calendar-panel">
      <div class="calendar-top">
        <div><h2 id="result-title">${result.rosterCalendar ? 'Jadwal Roster' : 'Kalender Hasil'}</h2><p>${escape(formatPeriod(result.period))} <span class="separator">·</span> Diperiksa ${escape(coverageLabel(result))}</p></div>
        <label class="search-field">${icon('search')}<input id="employee-search" type="search" placeholder="Cari nama atau NIK" aria-label="Cari nama atau NIK" value="${escape(state.search)}"></label>
      </div>
      <div class="source-summary">${icon('sheet')}<strong>Sumber pemeriksaan</strong> ${sourceNotice(result)}</div>
      <div class="table-scroll" tabindex="0" aria-label="Kalender absensi per karyawan dan tanggal">
        <table class="calendar-table" id="attendance-calendar">${calendarContent(result, state.search, state.warningFilter)}</table>
      </div>
      <div class="calendar-footer"><div class="legend">${attendanceLegend(Boolean(result.coveredDays))}</div></div>
    </section>
  </section>`;
}

function auditForm(state, working) {
  const dates = daysInPeriod(state.period);
  const locked = state.demo || working || state.pendingSave;
  const archiveReady = state.monthStatus === 'ready';
  const available = sources.filter(source => state.files[source.key] || (source.key === 'roster' && state.month?.roster_id));
  const button = state.pendingSave && !working
    ? '<button class="button primary audit-button" type="button" data-action="retry-save">Coba simpan lagi</button>'
    : `<button class="button primary audit-button" type="submit"${disabled(working || state.demo || !archiveReady)}>${working ? `<span class="spinner"></span> ${state.saving ? 'Menyimpan…' : 'Memeriksa…'}` : `Cek dan simpan ${icon('arrow')}`}</button>`;
  return `<form id="audit-form" class="audit-form team-upload" aria-label="Unggah file Sub Departemen">
      <div class="section-heading"><h2>Unggah file Sub Departemen</h2><span>${escape(state.team.name)}</span></div>
      <div class="upload-grid">${sources.map(source => uploadCard(source, state)).join('')}</div>
      <div class="period-bar">
        <div class="period-field"><label for="period">Periode absensi</label><input id="period" name="period" type="month" min="${escape(state.retentionPeriod)}" value="${escape(state.period)}" required${disabled(locked)}></div>
        <div class="period-field"><label for="start">Tarikan mulai</label><input id="start" name="start" type="date" min="${dates[0]?.key ?? ''}" max="${dates.at(-1)?.key ?? ''}" value="${escape(state.start)}" required${disabled(locked)}></div>
        <div class="period-field"><label for="end">Tarikan selesai</label><input id="end" name="end" type="date" min="${dates[0]?.key ?? ''}" max="${dates.at(-1)?.key ?? ''}" value="${escape(state.end)}" required${disabled(locked)}></div>
        ${button}
      </div>
      <p class="period-hint">${available.length ? `${escape(state.team.name)} · ${state.start && state.end ? escape(coverageLabel(state)) : escape(formatPeriod(state.period))} · ${available.map(source => source.name).join(' + ')}` : 'Pilih dua atau tiga sumber pemeriksaan.'}</p>
      ${working ? `<p class="notice progress" id="audit-progress" role="status">${escape(state.progress)}</p>` : ''}
      ${state.error ? `<p class="notice error" role="alert">${icon('alert')} ${escape(state.error)}</p>` : ''}
      ${state.pendingSave && !working ? '<button class="text-button reset-button" type="button" data-action="new-check">Batalkan unggahan ini</button>' : ''}
    </form>`;
}

export function dashboardView(state) {
  const working = state.busy || state.saving;
  return `<main class="dashboard team-dashboard">
    <section class="dashboard-intro">
      <div><p class="page-context">${escape(state.departmentName)}</p><h1>${escape(state.team.name)}</h1><p>${escape(formatPeriod(state.period))}${state.latestPeriod && state.latestPeriod !== state.period ? ' · Riwayat' : ''}</p></div>
      <div class="dashboard-actions">
        ${state.team.editable ? `<button class="button primary" type="button" data-action="toggle-upload" aria-expanded="${state.showUpload}"${disabled(working || state.pendingSave)}>${icon('upload')} Unggah file</button>` : ''}
        ${state.demo ? '' : `<button class="button secondary" type="button" data-action="history"${disabled(working || state.monthStatus !== 'ready')}>${icon('history')} Riwayat</button>`}
        ${state.batches.length ? `<button type="button" class="button secondary" data-action="files"${disabled(working)}>${icon('download')} File per rentang</button>` : ''}
      </div>
    </section>
    ${state.monthStatus === 'loading' ? '<p class="notice progress" role="status"><span class="spinner"></span> Memuat kalender Sub Departemen…</p>' : ''}
    ${state.monthError || state.leaveError ? `<div class="notice error" role="alert">${icon('alert')}<span>${escape(state.monthError || state.leaveError)}</span><button type="button" class="text-button" data-action="refresh-month">Muat ulang</button></div>` : ''}
    ${state.notice ? `<p class="notice saved" role="status">${icon('check')} ${escape(state.notice)}</p>` : ''}
    ${state.showUpload && state.team.editable ? auditForm(state, working) : ''}
    <div class="calendar-controls">
      <label class="check-control"><input id="check-leave" type="checkbox"${state.checkLeave ? ' checked' : ''}> Kroscek Form Cuti</label>
    </div>
    ${resultPanel(state)}
    <footer class="dashboard-footer">${watermark}</footer>
  </main>
  <dialog id="detail-dialog" aria-labelledby="detail-title"></dialog>
  <dialog id="files-dialog" aria-labelledby="files-title"></dialog>
  ${state.demo ? '' : '<dialog id="history-dialog" aria-labelledby="history-title"></dialog>'}`;
}

export function employeeCalendarView(result, employee, rowIndex, editable) {
  const labels = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const offset = (result.days[0].weekday + 6) % 7;
  return `<div class="dialog-head"><div><p class="detail-date">${escape(formatPeriod(result.period))} · ${escape(employee.nik)}</p><h2 id="detail-title" tabindex="-1">${escape(employee.name)}</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div>
    <label class="check-control grade-control"><input type="checkbox" data-grade-row="${rowIndex}"${employee.gradeTwoUp ? ' checked' : ''}${disabled(!editable)}> Golongan 2 Up</label>
    <div class="employee-month" aria-label="Kalender kehadiran">
      ${labels.map(label => `<span class="employee-weekday" aria-hidden="true">${label}</span>`).join('')}
      ${'<span aria-hidden="true"></span>'.repeat(offset)}
      ${result.days.map((day, index) => {
        const cell = employee.cells[index];
        const label = `${formatDate(day.key)}, ${cell.code || 'kode kosong'}. ${checkMessage(cell)}`;
        return `<button type="button" class="employee-day ${checkClass(cell)}" data-action="detail" data-row="${rowIndex}" data-day="${index}" data-from-calendar="true" aria-label="${escape(label)}"><small>${day.day}</small><strong>${escape(cell.code || '—')}</strong></button>`;
      }).join('')}
    </div>
    <div class="employee-legend legend">${attendanceLegend(Boolean(result.coveredDays))}</div>`;
}

function offCycleDetail(cycle, date) {
  if (!cycle) return '';
  const { lastOff, start, position, counted } = cycle;
  const offLabel = lastOff
    ? `${formatDate(lastOff.date)} · ${lastOff.kind === 'review' ? 'L dikonfirmasi' : 'Roster OFF dan Absensi L'}`
    : 'Belum tercatat dalam rentang yang diperiksa';
  let positionLabel = 'Siklus baru';
  if (counted) positionLabel = `Hari ke-${position}`;
  else if (lastOff?.date === date) positionLabel = 'OFF';
  else if (start.kind === 'leave' && date <= start.date) positionLabel = 'Cuti CR';
  else if (position) positionLabel = `Posisi terakhir hari ke-${position}`;
  const startLabel = start.kind === 'coverage' ? `Data diperiksa sejak ${formatDate(start.date)}`
    : start.kind === 'leave' ? `Setelah cuti CR selesai ${formatDate(start.date)}` : '';
  return `<section class="off-cycle-detail" aria-labelledby="off-cycle-title">
    <h3 id="off-cycle-title">Siklus OFF</h3><dl>
      <div><dt>Posisi siklus</dt><dd>${escape(positionLabel)}</dd></div>
      <div><dt>OFF terakhir</dt><dd>${escape(offLabel)}</dd></div>
      ${startLabel ? `<div><dt>Awal hitungan</dt><dd>${escape(startLabel)}</dd></div>` : ''}
    </dl>
  </section>`;
}

export function detailView(employee, day, cell, rowIndex, dayIndex, fromCalendar, editable) {
  const tone = checkTone(cell);
  const fields = [
    ['NIK', employee.nik], ['ID Live Attendance', cell.fingerId || employee.fingerId], ['Kode Roster', cell.rosterCode || '—'],
    ['Kode yang sesuai', cell.expected || (['I', 'IK', 'NR'].includes(cell.rosterCode) ? 'Dilewati' : '—')],
    ['Kode Absensi', cell.sourceKeys && !cell.sourceKeys.includes('absensi') ? 'Belum tersedia' : cell.code || '—'], ['Live Attendance In', formatClock(cell.firstIn)], ['Live Attendance Out', formatClock(cell.lastOut)],
  ];
  if (cell.formCode !== undefined) fields.push(['Kode di Form Cuti', cell.formCode || 'Belum tercatat']);
  const statusIcon = ['normal', 'green'].includes(tone) ? 'check' : tone === 'uncovered' ? 'calendar' : tone === 'orange' ? 'clock' : 'alert';
  return `<div class="dialog-head"><div><p class="detail-date">${escape(formatDate(day.key))}</p><h2 id="detail-title" tabindex="-1">${escape(employee.name)}</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></div>
    <div class="detail-reason ${tone}">${icon(statusIcon)}<strong>${escape(checkMessage(cell))}</strong></div>
    <dl class="detail-data">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    ${offCycleDetail(cell.offCycle, day.key)}
    <div class="dialog-actions detail-actions">
      ${editable && (cell.status === 'red' || cell.reviewed) ? `<label class="check-control"><input type="checkbox" data-review-row="${rowIndex}" data-review-day="${dayIndex}" data-from-calendar="${fromCalendar}"${cell.reviewed ? ' checked' : ''}> Sudah dicek</label>` : ''}
      ${fromCalendar ? `<button type="button" class="button secondary" data-action="employee-calendar" data-row="${rowIndex}">Kembali ke kalender</button>` : ''}
    </div>`;
}
