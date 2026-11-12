const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const roles = new Set(['department_admin']);
const accounts = 'attendance_accounts';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const reply = (data, status = 200) => Response.json(data, { status, headers: cors });
const fail = (message, status) => reply({ error: message }, status);

async function cleanup(client, projectUrl, key) {
  const prepared = await client.rpc('attendance_prepare_cleanup', { p_project_url: projectUrl, p_key: key });
  if (prepared.error) return fail('Pembersihan arsip gagal.', prepared.error.code === '42501' ? 403 : 500);
  let removed = 0;
  for (let batch = 0; batch < 10; batch++) {
    const { data, error } = await client.rpc('attendance_cleanup_files');
    if (error) return fail('Antrean file gagal dimuat.', 500);
    if (!data?.length) return reply({ removed });
    const grouped = new Map();
    for (const { bucket, path } of data) {
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket).push(path);
    }
    for (const [bucket, paths] of grouped) {
      const deletion = await client.storage.from(bucket).remove(paths);
      if (deletion.error) return fail('File arsip gagal dihapus. Pembersihan akan dicoba lagi.', 500);
      const ack = await client.rpc('attendance_ack_cleanup', { p_bucket: bucket, p_paths: paths });
      if (ack.error) return fail('Antrean penghapusan gagal diperbarui.', 500);
      removed += paths.length;
    }
  }
  return reply({ removed, queued: true });
}

async function assignedDepartment(client, id) {
  if (!uuid.test(id ?? '')) return false;
  const { data, error } = await client.from('attendance_departments').select('id').eq('id', id).maybeSingle();
  return !error && Boolean(data);
}

async function createAccount(client, input) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || !roles.has(input.role)
    || !await assignedDepartment(client, input.department_id)) {
    return fail('Lengkapi email, kata sandi, peran, dan departemen.', 400);
  }
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) return fail(
    error?.code === 'email_exists' || error?.code === 'user_already_exists'
      ? 'Email ini sudah terdaftar di Supabase.'
      : error?.code === 'weak_password' ? 'Kata sandi belum memenuhi pengaturan Supabase.' : 'Akun gagal dibuat di Supabase.',
    400,
  );
  const id = data.user.id;
  const saved = await client.from(accounts).insert({ user_id: id, email, role: input.role, department_id: input.department_id });
  if (saved.error) {
    const check = await client.from(accounts).select('user_id').eq('user_id', id).maybeSingle();
    if (check.data) return reply({ id });
    if (!check.error) await client.auth.admin.deleteUser(id);
    return fail('Hak akses akun gagal disimpan. Muat ulang daftar akun.', 500);
  }
  return reply({ id }, 201);
}

async function changeAccount(client, input) {
  const id = input.user_id;
  if (!uuid.test(id ?? '')) return fail('Pilih akun yang ingin dikelola.', 400);
  const { data: account, error } = await client.from(accounts).select('user_id,role,active,department_id').eq('user_id', id).maybeSingle();
  if (error) return fail('Akun gagal dimuat.', 500);
  if (!account || account.role === 'administrator') return fail('Pilih akun Admin.', 400);

  if (input.action === 'delete') {
    const disabled = await client.from(accounts).update({ active: false }).eq('user_id', id);
    if (disabled.error) return fail('Akun gagal dinonaktifkan.', 500);
    // The Auth identity is soft-deleted so Storage ownership does not remove the Sub Departemen's files.
    const deletion = await client.auth.admin.deleteUser(id, true);
    if (deletion.error && deletion.error.code !== 'user_not_found') {
      return fail('Akun sudah nonaktif. Penghapusan akun Supabase gagal dan bisa dicoba lagi.', 500);
    }
    const profile = await client.from(accounts).delete().eq('user_id', id);
    if (profile.error) return fail('Akun sudah dicabut. Coba hapus kembali untuk menyelesaikan pembersihan daftar akun.', 500);
    return reply({ id });
  }

  let changes;
  if (input.action === 'set-active' && typeof input.active === 'boolean') {
    if (input.active) {
      const authUser = await client.auth.admin.getUserById(id);
      if (authUser.error || !authUser.data?.user?.email || authUser.data.user.deleted_at) {
        return fail('Akun Auth sudah dihapus. Buat akun pengganti.', 400);
      }
    }
    changes = { active: input.active };
  } else if (input.action === 'update' && roles.has(input.role) && await assignedDepartment(client, input.department_id)) {
    changes = { role: input.role, department_id: input.department_id };
  } else {
    return fail('Perubahan akun belum lengkap.', 400);
  }
  const updated = await client.from(accounts).update(changes).eq('user_id', id).neq('role', 'administrator');
  return updated.error ? fail('Perubahan akun gagal disimpan.', 500) : reply({ id });
}

export function attendanceAdminHandler(client, projectUrl) {
  return async request => {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return fail('Gunakan POST.', 405);
      const cleanupKey = request.headers.get('x-attendance-cleanup');
      if (cleanupKey) return await cleanup(client, projectUrl, cleanupKey);
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return fail('Sesi login diperlukan.', 401);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return fail('Sesi login perlu diperbarui.', 401);
      const actor = await client.from(accounts).select('role,active').eq('user_id', data.user.id).maybeSingle();
      if (actor.error) return fail('Pengaturan akun belum tersedia.', 503);
      if (actor.data?.role !== 'administrator' || !actor.data.active) return fail('Akses Administrator diperlukan.', 403);
      let input;
      try { input = await request.json(); } catch { return fail('Data akun belum valid.', 400); }
      if (!input || typeof input !== 'object') return fail('Data akun belum valid.', 400);
      if (input.action === 'create') return await createAccount(client, input);
      if (['update', 'set-active', 'delete'].includes(input.action)) return await changeAccount(client, input);
      return fail('Tindakan akun belum valid.', 400);
    } catch {
      return fail('Layanan pengelolaan akun gagal. Coba lagi.', 500);
    }
  };
}
