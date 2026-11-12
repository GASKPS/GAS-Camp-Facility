import { brand, disabled, escape, icon } from './views.js';

const roles = { administrator: 'Administrator', department_admin: 'Admin', team_admin: 'Admin' };

function sidebar(state) {
  const groups = state.departments.map(department => ({
    ...department, teams: state.teams.filter(team => team.department_id === department.id),
  })).filter(department => department.teams.length);
  const managing = location.hash === '#kelola';
  const leavePage = location.hash === '#form-cuti';
  const locked = state.saving || state.busy || state.pendingSave || state.mutating;
  const canManage = ['administrator', 'department_admin'].includes(state.profile?.role);
  return `<aside class="team-sidebar">
    <div class="sidebar-brand">${brand('brand-light')}</div>
    <nav class="sidebar-nav" aria-label="Navigasi Sub Departemen">
      ${groups.map(group => `<div class="sidebar-group"><span class="sidebar-group-name">${escape(group.name)}</span>
        ${group.teams.map(team => `<button type="button" class="side-link ${team.id === state.team?.id && !managing && !leavePage ? 'selected' : ''}" data-action="select-team" data-id="${escape(team.id)}" aria-current="${team.id === state.team?.id && !managing && !leavePage ? 'page' : 'false'}"${disabled(locked)}>${icon('calendar')}<span>${escape(team.name)}</span></button>`).join('')}
      </div>`).join('')}
      ${state.team ? `<button type="button" class="side-link utility-link ${leavePage ? 'selected' : ''}" data-action="open-leave-page"${disabled(locked)}>${icon('clipboard')} <span>Form Cuti</span></button>` : ''}
      ${canManage ? `<button type="button" class="side-link utility-link ${managing ? 'selected' : ''}" data-action="manage-workspace"${disabled(locked)}>${icon('settings')} <span>${state.profile.role === 'administrator' ? 'Kelola akses' : 'Kelola Sub Departemen'}</span></button>` : ''}
    </nav>
    <div class="sidebar-account">
      <span class="sidebar-avatar">${escape((state.user?.email?.[0] ?? 'D').toUpperCase())}</span>
      <div><strong>${escape(state.demo ? 'Data contoh' : roles[state.profile?.role] || 'Akun Supabase')}</strong><small title="${escape(state.user?.email)}">${escape(state.user?.email)}</small></div>
      <button class="icon-button" type="button" data-action="${state.demo ? 'exit-demo' : 'logout'}" title="Keluar" aria-label="Keluar"${disabled(state.authBusy)}>${icon('logout')}</button>
    </div>
  </aside>`;
}

export function workspaceFrame(state, content) {
  return `<div class="team-workspace">${sidebar(state)}<div class="workspace-body">${content}</div></div>
    <dialog id="confirm-dialog" aria-labelledby="confirm-title"></dialog>`;
}

export function workspaceEmpty(state) {
  const problem = state.workspaceStatus;
  let title = 'Pilih Sub Departemen';
  let text = 'Pilih Sub Departemen di sidebar untuk membuka kalender absensinya.';
  let action = '';
  if (problem === 'loading') {
    title = 'Memuat ruang kerja';
    text = 'Menyiapkan Sub Departemen sesuai hak akses akun Anda.';
  } else if (problem === 'setup' || problem === 'unassigned') {
    title = problem === 'setup' ? 'Siapkan database Sub Departemen' : 'Akun belum mendapat akses';
    text = problem === 'setup'
      ? 'Jalankan SQL pemasangan ruang kerja di proyek Supabase yang dipakai web ini.'
      : 'Administrator dapat menugaskan akun ini ke Departemen dan Sub Departemen.';
    action = '<button class="button secondary" data-action="refresh-workspace" type="button">Muat ulang akses</button>';
    if (problem === 'setup' && state.config?.url) {
      const project = new URL(state.config.url).hostname.split('.')[0];
      action += `<a class="button primary" target="_blank" rel="noopener" href="https://supabase.com/dashboard/project/${escape(project)}/sql/new">SQL Editor proyek ini</a>`;
    }
  } else if (problem === 'inactive') {
    title = 'Akun dinonaktifkan';
    text = 'Hubungi Administrator untuk mengaktifkan kembali akun.';
  } else if (problem === 'error') {
    title = 'Ruang kerja gagal dimuat';
    text = state.workspaceError;
    action = '<button class="button secondary" data-action="refresh-workspace" type="button">Coba lagi</button>';
  } else if (!state.teams.length) {
    title = 'Belum ada Sub Departemen';
    text = state.profile?.role === 'administrator' ? 'Buat Departemen dan Sub Departemen untuk menyiapkan ruang kerja.'
      : state.profile?.role === 'department_admin' ? 'Buat Sub Departemen di bawah Departemen Anda.'
        : 'Administrator dapat memberikan akses Sub Departemen ke akun ini.';
    if (['administrator', 'department_admin'].includes(state.profile?.role)) {
      action = '<button class="button primary" data-action="manage-workspace" type="button">Kelola ruang kerja</button>';
    }
  }
  return `<main class="dashboard workspace-empty"><div class="workspace-blank">
    <span class="empty-icon">${icon(problem === 'inactive' ? 'lock' : 'calendar')}</span>
    <h1>${escape(title)}</h1><p>${escape(text)}</p>${action}
  </div></main>`;
}

function options(items, value, empty) {
  return `${empty ? `<option value="">${escape(empty)}</option>` : ''}${items.map(([id, label]) =>
    `<option value="${escape(id)}"${id === value ? ' selected' : ''}>${escape(label)}</option>`).join('')}`;
}

function editControls(type, id, busy) {
  return `<button type="button" class="button secondary history-button" data-action="edit-management" data-type="${type}" data-id="${escape(id)}"${disabled(busy)}>Ubah</button>`;
}

function saveActions(editing, busy, label) {
  return `<div class="leave-actions">${editing ? `<button type="button" class="button secondary" data-action="cancel-management"${disabled(busy)}>Batal</button>` : ''}
    <button type="submit" class="button primary"${disabled(busy)}>${editing ? 'Simpan perubahan' : label}</button></div>`;
}

function departmentsPanel(state, page) {
  const entry = page.entry ?? {};
  return `<section class="management-card">
    <div class="section-heading"><h2>Departemen</h2></div>
    <form class="leave-form" id="department-form">
      <label>Nama departemen<input name="name" maxlength="100" value="${escape(entry.name)}" required${disabled(page.busy)}></label>
      ${saveActions(Boolean(entry.id), page.busy, 'Buat departemen')}
    </form>
    ${state.departments.length ? `<ul class="history-list">${state.departments.map(row =>
      `<li class="history-item"><strong>${escape(row.name)}</strong>${editControls('departments', row.id, page.busy)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function accountsPanel(state, page) {
  const entry = page.entry ?? {};
  const departments = state.departments.map(row => [row.id, row.name]);
  const nameByDepartment = new Map(departments);
  return `<section class="management-card">
    <div class="section-heading"><h2>${entry.user_id ? 'Ubah akses akun' : 'Buat akun'}</h2></div>
    ${departments.length ? `<form class="leave-form" id="account-form">
      <label>Email<input name="email" type="email" autocomplete="off" value="${escape(entry.email)}" required${disabled(page.busy || entry.user_id)}></label>
      ${entry.user_id ? '' : `<label>Kata sandi awal<input name="password" type="password" autocomplete="new-password" required${disabled(page.busy)}></label>`}
      <label>Departemen<select name="department_id" required${disabled(page.busy)}>${options(departments, entry.department_id, 'Pilih departemen')}</select></label>
      ${saveActions(Boolean(entry.user_id), page.busy, 'Buat akun')}
    </form>` : '<p class="muted">Tambahkan departemen untuk membuat akun admin.</p>'}
    <ul class="history-list">${(page.data?.accounts ?? []).map(row => `<li class="history-item">
      <div><strong>${escape(row.email)}</strong><p>${escape(roles[row.role])}${row.department_id ? ` · ${escape(nameByDepartment.get(row.department_id))}` : ''}</p>
        <span class="history-badge ${row.active ? 'mint' : 'red'}">${row.active ? 'Aktif' : 'Nonaktif'}</span></div>
      ${row.role === 'administrator' ? '' : `<div class="leave-item-actions">${editControls('accounts', row.user_id, page.busy)}
        <button class="button secondary history-button" type="button" data-action="account-status" data-id="${escape(row.user_id)}"${disabled(page.busy)}>${row.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="text-button leave-delete" type="button" data-action="account-delete" data-id="${escape(row.user_id)}"${disabled(page.busy)}>Hapus</button>
      </div>`}
    </li>`).join('')}</ul>
  </section>`;
}

function teamsPanel(state, page) {
  const entry = page.entry ?? {};
  const departments = state.departments.map(row => [row.id, row.name]);
  const global = state.profile.role === 'administrator';
  const teams = global ? page.data?.teams ?? [] : state.teams;
  const selected = teams.find(team => team.id === page.accessTeam) ?? teams[0];
  const members = (page.data?.accounts ?? []).filter(row => row.department_id === selected?.department_id);
  const grants = new Set(page.data?.grants.filter(row => row.team_id === selected?.id).map(row => row.user_id) ?? []);
  return `<section class="management-card">
    <div class="section-heading"><h2>Sub Departemen</h2></div>
    ${departments.length ? `<form class="leave-form" id="team-form">
      <label>Nama Sub Departemen<input name="name" maxlength="100" value="${escape(entry.name)}" required${disabled(page.busy)}></label>
      <label>Departemen<select name="department_id" required${disabled(page.busy || entry.id)}>${options(departments, entry.department_id ?? state.profile.department_id, 'Pilih departemen')}</select></label>
      ${saveActions(Boolean(entry.id), page.busy, 'Buat Sub Departemen')}
    </form>` : '<p class="muted">Tambahkan Departemen untuk membuat Sub Departemen.</p>'}
    ${teams.length ? `<ul class="history-list">${teams.map(row => `<li class="history-item"><div><strong>${escape(row.name)}</strong><p>${escape(departments.find(([id]) => id === row.department_id)?.[1])}</p></div>
      ${editControls('teams', row.id, page.busy)}</li>`).join('')}</ul>` : ''}
  </section>
  ${global && selected ? `<section class="management-card">
    <div class="section-heading"><h2>Akses isi absen</h2></div>
    <div class="leave-form access-picker"><label>Sub Departemen<select id="access-team"${disabled(page.busy)}>${options(teams.map(team => [team.id, team.name]), selected.id)}</select></label></div>
    ${members.length ? `<ul class="history-list">${members.map(row => `<li class="history-item">
      <div><strong>${escape(row.email)}</strong><p>${escape(roles[row.role])}${row.active ? '' : ' · Nonaktif'}</p></div>
      <label class="check-control"><input type="checkbox" data-grant-user="${escape(row.user_id)}" data-team="${escape(selected.id)}"${grants.has(row.user_id) ? ' checked' : ''}${disabled(page.busy)}> Boleh mengisi</label>
    </li>`).join('')}</ul>` : '<p class="history-empty muted">Belum ada akun di Departemen ini.</p>'}
  </section>` : ''}`;
}

export function managementView(state, page) {
  const global = state.profile.role === 'administrator';
  const tabs = global ? [['departments', 'Departemen'], ['accounts', 'Akun'], ['teams', 'Sub Departemen dan akses']] : [['teams', 'Sub Departemen dan akses']];
  return `<main class="dashboard leave-page workspace-management">
    <section class="dashboard-intro"><div><h1>${global ? 'Kelola akses' : 'Kelola Sub Departemen'}</h1><p>${global ? 'Atur Departemen, akun, dan penugasan Sub Departemen.' : 'Buat Sub Departemen dan ubah nama yang ditugaskan kepada Anda.'}</p></div></section>
    ${tabs.length > 1 ? `<nav class="leave-tabs" aria-label="Pengaturan ruang kerja">${tabs.map(([key, label]) =>
      `<button type="button" class="button ${page.tab === key ? 'primary' : 'secondary'}" data-action="management-tab" data-tab="${key}" aria-pressed="${page.tab === key}"${disabled(page.busy)}>${label}</button>`).join('')}</nav>` : ''}
    ${page.busy ? '<p class="notice progress" role="status"><span class="spinner"></span> Memuat perubahan…</p>' : ''}
    ${page.error ? `<p class="notice error" role="alert">${icon('alert')}${escape(page.error)}</p>` : ''}
    ${page.notice ? `<p class="notice saved" role="status">${icon('check')}${escape(page.notice)}</p>` : ''}
    ${page.tab === 'departments' ? departmentsPanel(state, page) : page.tab === 'accounts' ? accountsPanel(state, page) : teamsPanel(state, page)}
  </main>`;
}

export function confirmationView(title, message, label) {
  return `<div class="dialog-head"><h2 id="confirm-title">${escape(title)}</h2></div>
    <p class="confirm-message">${escape(message)}</p>
    <div class="dialog-actions">
      <button type="button" class="button secondary" data-action="cancel-confirm">Batal</button>
      <button type="button" class="button primary" data-action="accept-confirm">${escape(label)}</button>
    </div>`;
}
