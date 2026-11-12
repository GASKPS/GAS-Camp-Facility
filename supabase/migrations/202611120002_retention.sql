begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists attendance_private;
revoke all on schema attendance_private from public, anon, authenticated;

create table if not exists attendance_private.settings (
  id boolean primary key default true check (id),
  project_url text not null check (project_url ~ '^https://[a-z0-9-]+\.supabase\.co$'),
  cleanup_key text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  remove_trial_archives boolean not null default false
);
create table if not exists attendance_private.cleanup_queue (
  bucket text not null,
  path text not null,
  primary key (bucket, path)
);

create or replace function public.attendance_kick_cleanup()
returns bigint language sql security definer set search_path = ''
as $$
  select net.http_post(
    url := project_url || '/functions/v1/attendance-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-attendance-cleanup', cleanup_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) from attendance_private.settings where id
$$;

create or replace function public.attendance_configure(p_project_url text, p_admin_email text, p_remove_trial_archives boolean default false)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  administrator uuid;
  target_url text := rtrim(btrim(p_project_url), '/');
begin
  select id into administrator from auth.users
    where lower(email) = lower(btrim(p_admin_email)) and email_confirmed_at is not null and deleted_at is null;
  if administrator is null then
    raise exception 'Buat atau verifikasi akun Administrator di Authentication → Users terlebih dahulu.' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_accounts where role = 'administrator' and user_id <> administrator) then
    raise exception 'Administrator pertama sudah ditetapkan.' using errcode = '23505';
  end if;
  if exists (select 1 from attendance_private.settings where project_url <> target_url) then
    raise exception 'Project URL berbeda dari konfigurasi aplikasi.' using errcode = '22023';
  end if;
  insert into public.attendance_accounts(user_id, email, role, department_id, active)
    values (administrator, lower(btrim(p_admin_email)), 'administrator', null, true)
    on conflict (user_id) do update set role = excluded.role, department_id = null, active = true, email = excluded.email;
  insert into attendance_private.settings(project_url, remove_trial_archives)
    values (target_url, p_remove_trial_archives)
    on conflict (id) do update set remove_trial_archives =
      attendance_private.settings.remove_trial_archives or excluded.remove_trial_archives;

  perform cron.schedule('validasi-absensi-retensi', '15 15 * * *', 'select public.attendance_kick_cleanup();');
  perform public.attendance_kick_cleanup();
  return 'Administrator aktif. Pembersihan arsip dijadwalkan.';
end;
$$;

create or replace function public.attendance_prepare_cleanup(p_project_url text, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  settings attendance_private.settings%rowtype;
  oldest text := public.attendance_retention_period();
begin
  select * into settings from attendance_private.settings where id for update;
  if not found or settings.project_url is distinct from p_project_url or settings.cleanup_key is distinct from p_key then
    raise exception 'Akses pembersihan arsip ditolak.' using errcode = '42501';
  end if;

  if settings.remove_trial_archives then
    insert into attendance_private.cleanup_queue(bucket, path)
      select bucket_id, name from storage.objects
      where bucket_id = 'selaras-sumber'
        and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(absensi|roster|finger)$'
      on conflict do nothing;
    if to_regclass('public.attendance_months') is not null then
      delete from public.attendance_months;
      revoke select on public.attendance_months from anon, authenticated;
    end if;
    if to_regclass('public.attendance_checks') is not null then
      delete from public.attendance_checks;
      revoke select, insert on public.attendance_checks from anon, authenticated;
      if to_regprocedure('public.complete_attendance_check(uuid,jsonb)') is not null then
        revoke execute on function public.complete_attendance_check(uuid, jsonb) from anon, authenticated;
      end if;
    end if;
    update attendance_private.settings set remove_trial_archives = false where id;
  end if;

  insert into attendance_private.cleanup_queue(bucket, path)
    select o.bucket_id, o.name from storage.objects o
    join public.attendance_team_checks c
      on split_part(o.name, '/', 1) = c.team_id::text and split_part(o.name, '/', 2) = c.id::text
    where o.bucket_id = 'validasi-absensi-tim' and (
      c.period < oldest or (c.status = 'uploading' and c.created_at < now() - interval '2 days')
      or (c.status = 'replaced' and (
        split_part(o.name, '/', 3) <> 'roster' or not exists (
          select 1 from public.attendance_team_months m where m.team_id = c.team_id and m.roster_id = c.id
        )
      ))
    ) on conflict do nothing;

  delete from public.attendance_team_reviews where attendance_date < (oldest || '-01')::date;
  delete from public.attendance_team_months where period < oldest;
  delete from public.attendance_team_checks c
    where c.period < oldest or (c.status = 'uploading' and c.created_at < now() - interval '2 days')
      or (c.status = 'replaced' and not exists (select 1 from public.attendance_team_months m where m.roster_id = c.id));
end;
$$;

create or replace function public.attendance_cleanup_files()
returns table (bucket text, path text) language sql stable security definer set search_path = ''
as $$
  select q.bucket, q.path from attendance_private.cleanup_queue q order by q.bucket, q.path limit 200
$$;

create or replace function public.attendance_ack_cleanup(p_bucket text, p_paths text[])
returns void language sql security definer set search_path = ''
as $$
  delete from attendance_private.cleanup_queue where bucket = p_bucket and path = any(p_paths)
$$;

revoke all on function public.attendance_configure(text, text, boolean), public.attendance_kick_cleanup(),
  public.attendance_prepare_cleanup(text, text), public.attendance_cleanup_files(), public.attendance_ack_cleanup(text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.attendance_prepare_cleanup(text, text), public.attendance_cleanup_files(),
  public.attendance_ack_cleanup(text, text[]) to service_role;

notify pgrst, 'reload schema';

commit;
