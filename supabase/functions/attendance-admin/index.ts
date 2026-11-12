import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { attendanceAdminHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Konfigurasi server Supabase belum tersedia.');

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
Deno.serve(attendanceAdminHandler(admin, url));
