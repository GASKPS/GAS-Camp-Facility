import { createClient } from '@supabase/supabase-js';

const configKey = 'selaras-supabase-config-v1';

function legacyAnonKey(key) {
  try {
    const [, payload] = key.split('.');
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return data.role === 'anon';
  } catch {
    return false;
  }
}

export function validateProject(input) {
  let url;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error('Masukkan Project URL Supabase yang valid.');
  }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Gunakan Project URL seperti https://nama-proyek.supabase.co.');
  }
  const key = input.key.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !legacyAnonKey(key)) {
    throw new Error('Gunakan Publishable Key Supabase atau kunci anon.');
  }
  return { url: url.origin, key };
}

export function initialProject() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url || key) {
    if (!url || !key) throw new Error('Lengkapi Project URL dan Publishable Key pada konfigurasi Validasi Absensi.');
    return { config: validateProject({ url, key }), fixed: true };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(configKey) ?? 'null');
    if (saved) return { config: validateProject(saved), fixed: false };
  } catch {
    // A browser with cleared or unavailable storage can configure its project again.
  }
  return { config: null, fixed: false };
}

export function saveProject(config) {
  localStorage.setItem(configKey, JSON.stringify(config));
}

export function createAuthClient(config) {
  return createClient(config.url, config.key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
}
