begin;

create table if not exists public.attendance_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100)
);
create unique index if not exists attendance_department_name on public.attendance_departments(lower(name));

create table if not exists public.attendance_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('administrator', 'department_admin', 'team_admin')),
  department_id uuid references public.attendance_departments(id),
  active boolean not null default true,
  check ((role = 'administrator') = (department_id is null))
);
create unique index if not exists attendance_one_administrator on public.attendance_accounts(role) where role = 'administrator';
create index if not exists attendance_accounts_department on public.attendance_accounts(department_id);

create table if not exists public.attendance_teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.attendance_departments(id),
  name text not null check (length(btrim(name)) between 1 and 100)
);
create unique index if not exists attendance_team_name on public.attendance_teams(department_id, lower(name));

create table if not exists public.attendance_team_access (
  team_id uuid not null references public.attendance_teams(id) on delete cascade,
  user_id uuid not null references public.attendance_accounts(user_id) on delete cascade,
  primary key (team_id, user_id)
);
create index if not exists attendance_access_user on public.attendance_team_access(user_id);

create or replace function public.attendance_is_administrator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_accounts
    where user_id = (select auth.uid()) and active and role = 'administrator'
  )
$$;

create or replace function public.attendance_manages_department(p_department uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_accounts
    where user_id = (select auth.uid()) and active
      and (role = 'administrator' or (role = 'department_admin' and department_id = p_department))
  )
$$;

create or replace function public.attendance_can_access_team(p_team uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_accounts a
    join public.attendance_teams t on t.id = p_team
    where a.user_id = (select auth.uid()) and a.active and (
      (a.role = 'administrator' and not p_write)
      or (a.department_id = t.department_id and exists (
        select 1 from public.attendance_team_access g where g.user_id = a.user_id and g.team_id = t.id
      ))
    )
  )
$$;

create or replace function public.attendance_can_manage_team(p_team uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_teams t
    where t.id = p_team and public.attendance_manages_department(t.department_id)
  )
$$;

create or replace function public.attendance_retention_period()
returns text language sql stable set search_path = ''
as $$
  select to_char(date_trunc('month', now() at time zone 'Asia/Jayapura') - interval '2 months', 'YYYY-MM')
$$;

alter table public.attendance_departments enable row level security;
alter table public.attendance_accounts enable row level security;
alter table public.attendance_teams enable row level security;
alter table public.attendance_team_access enable row level security;

revoke all on public.attendance_departments, public.attendance_accounts, public.attendance_teams, public.attendance_team_access
  from public, anon, authenticated;
grant select on public.attendance_departments, public.attendance_accounts, public.attendance_teams, public.attendance_team_access
  to authenticated;
grant select, insert, update, delete on public.attendance_accounts to service_role;

drop policy if exists attendance_departments_read on public.attendance_departments;
create policy attendance_departments_read on public.attendance_departments for select to authenticated
  using (public.attendance_manages_department(id) or exists (
    select 1 from public.attendance_accounts a where a.user_id = (select auth.uid()) and a.active and a.department_id = id
  ));
drop policy if exists attendance_accounts_read on public.attendance_accounts;
create policy attendance_accounts_read on public.attendance_accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.attendance_manages_department(department_id));
drop policy if exists attendance_teams_read on public.attendance_teams;
create policy attendance_teams_read on public.attendance_teams for select to authenticated
  using (public.attendance_manages_department(department_id) or public.attendance_can_access_team(id));
drop policy if exists attendance_access_read on public.attendance_team_access;
create policy attendance_access_read on public.attendance_team_access for select to authenticated
  using (public.attendance_can_manage_team(team_id) or (user_id = (select auth.uid()) and public.attendance_can_access_team(team_id)));

create or replace function public.attendance_workspace()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(a) from public.attendance_accounts a where a.user_id = (select auth.uid())),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) || jsonb_build_object('editable', public.attendance_can_access_team(t.id, true)) order by t.name)
      from public.attendance_teams t where public.attendance_can_access_team(t.id)
    ), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(to_jsonb(d) order by d.name) from public.attendance_departments d), '[]'::jsonb),
    'retention_period', public.attendance_retention_period()
  )
$$;

create or replace function public.attendance_save_department(p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare saved uuid;
begin
  if not public.attendance_is_administrator() then raise exception 'Akses Administrator diperlukan.' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.attendance_departments(name) values (btrim(p_name)) returning id into saved;
  else
    update public.attendance_departments set name = btrim(p_name) where id = p_id returning id into saved;
  end if;
  if saved is null then raise exception 'Departemen tidak ditemukan.' using errcode = 'P0002'; end if;
  return saved;
end;
$$;

create or replace function public.attendance_save_team(p_id uuid, p_department uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare saved uuid;
begin
  if not public.attendance_manages_department(p_department) then raise exception 'Akses departemen diperlukan.' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.attendance_teams(department_id, name) values (p_department, btrim(p_name)) returning id into saved;
    if not public.attendance_is_administrator() then
      insert into public.attendance_team_access(team_id, user_id) values (saved, auth.uid());
    end if;
  else
    update public.attendance_teams set name = btrim(p_name) where id = p_id and department_id = p_department returning id into saved;
  end if;
  if saved is null then raise exception 'Tim tidak ditemukan.' using errcode = 'P0002'; end if;
  return saved;
end;
$$;

create or replace function public.attendance_set_team_access(p_team uuid, p_user uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.attendance_can_manage_team(p_team) then raise exception 'Akses kelola tim diperlukan.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.attendance_accounts a join public.attendance_teams t on t.department_id = a.department_id
    where a.user_id = p_user and t.id = p_team
  ) then raise exception 'Pilih akun dari departemen tim ini.' using errcode = '22023'; end if;
  if p_enabled then
    insert into public.attendance_team_access(team_id, user_id) values (p_team, p_user) on conflict do nothing;
  else
    delete from public.attendance_team_access where team_id = p_team and user_id = p_user;
  end if;
end;
$$;

create or replace function public.attendance_remove_stale_team_access()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.attendance_team_access a using public.attendance_teams t
  where a.team_id = t.id and a.user_id = new.user_id and t.department_id is distinct from new.department_id;
  return new;
end;
$$;
drop trigger if exists attendance_account_departments_changed on public.attendance_accounts;
create trigger attendance_account_departments_changed after update of department_id on public.attendance_accounts
  for each row when (old.department_id is distinct from new.department_id) execute function public.attendance_remove_stale_team_access();

create table if not exists public.attendance_team_checks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.attendance_teams(id),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  scan_start date not null,
  scan_end date not null,
  source_files jsonb not null check (jsonb_typeof(source_files) = 'object'),
  roster_id uuid,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'replaced')),
  result jsonb,
  totals jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (scan_start <= scan_end and to_char(scan_start, 'YYYY-MM') = period and to_char(scan_end, 'YYYY-MM') = period)
);
create index if not exists attendance_team_check_period on public.attendance_team_checks(team_id, period, status);

create table if not exists public.attendance_team_months (
  team_id uuid not null references public.attendance_teams(id),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  roster_id uuid references public.attendance_team_checks(id),
  roster_file jsonb,
  roster_rows jsonb,
  coverage jsonb not null default '{}' check (jsonb_typeof(coverage) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (team_id, period)
);

alter table public.attendance_team_checks enable row level security;
alter table public.attendance_team_months enable row level security;
revoke all on public.attendance_team_checks, public.attendance_team_months from public, anon, authenticated;
grant select on public.attendance_team_checks, public.attendance_team_months to authenticated;
grant insert (id, team_id, period, scan_start, scan_end, source_files, roster_id) on public.attendance_team_checks to authenticated;
drop policy if exists attendance_team_checks_read on public.attendance_team_checks;
create policy attendance_team_checks_read on public.attendance_team_checks for select to authenticated
  using (period >= public.attendance_retention_period() and public.attendance_can_access_team(team_id)
    and (status <> 'uploading' or uploaded_by = (select auth.uid())));
drop policy if exists attendance_team_checks_stage on public.attendance_team_checks;
create policy attendance_team_checks_stage on public.attendance_team_checks for insert to authenticated
  with check (period >= public.attendance_retention_period() and uploaded_by = (select auth.uid())
    and public.attendance_can_access_team(team_id, true) and status = 'uploading');
drop policy if exists attendance_team_months_read on public.attendance_team_months;
create policy attendance_team_months_read on public.attendance_team_months for select to authenticated
  using (period >= public.attendance_retention_period() and public.attendance_can_access_team(team_id));

insert into storage.buckets(id, name, public) values ('validasi-absensi-tim', 'validasi-absensi-tim', false)
on conflict (id) do update set public = false;

create or replace function public.attendance_team_storage_allowed(p_name text, p_write boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_team_checks c
    where c.team_id::text = split_part(p_name, '/', 1) and c.id::text = split_part(p_name, '/', 2)
      and p_name = c.team_id::text || '/' || c.id::text || '/' || split_part(p_name, '/', 3)
      and split_part(p_name, '/', 3) in ('absensi', 'roster', 'finger')
      and c.source_files ? split_part(p_name, '/', 3)
      and (split_part(p_name, '/', 3) <> 'roster' or c.roster_id is null or c.roster_id = c.id)
      and c.period >= public.attendance_retention_period()
      and public.attendance_can_access_team(c.team_id, p_write)
      and ((c.status = 'uploading' and c.uploaded_by = (select auth.uid()))
        or (not p_write and (c.status = 'ready' or (
          split_part(p_name, '/', 3) = 'roster' and exists (
            select 1 from public.attendance_team_months m where m.team_id = c.team_id and m.roster_id = c.id
          )
        ))))
  )
$$;
drop policy if exists attendance_team_bucket_select on storage.objects;
create policy attendance_team_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'validasi-absensi-tim' and public.attendance_team_storage_allowed(name, false));
drop policy if exists attendance_team_bucket_insert on storage.objects;
create policy attendance_team_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'validasi-absensi-tim' and public.attendance_team_storage_allowed(name, true));
-- Keep the attendance bucket isolated even in projects with a permissive Storage policy.
drop policy if exists attendance_team_bucket_read_boundary on storage.objects;
create policy attendance_team_bucket_read_boundary on storage.objects as restrictive for select to public
  using (bucket_id <> 'validasi-absensi-tim' or public.attendance_team_storage_allowed(name, false));
drop policy if exists attendance_team_bucket_insert_boundary on storage.objects;
create policy attendance_team_bucket_insert_boundary on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'validasi-absensi-tim' or public.attendance_team_storage_allowed(name, true));
drop policy if exists attendance_team_bucket_update_boundary on storage.objects;
create policy attendance_team_bucket_update_boundary on storage.objects as restrictive for update to public
  using (bucket_id <> 'validasi-absensi-tim') with check (bucket_id <> 'validasi-absensi-tim');
drop policy if exists attendance_team_bucket_delete_boundary on storage.objects;
create policy attendance_team_bucket_delete_boundary on storage.objects as restrictive for delete to public
  using (bucket_id <> 'validasi-absensi-tim');

create or replace function public.attendance_complete_team_check(p_id uuid, p_result jsonb)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  run public.attendance_team_checks%rowtype;
  monthly public.attendance_team_months%rowtype;
  selected_roster uuid;
  selected_file jsonb;
  selected_rows jsonb;
  coverage_days jsonb;
  source_count integer;
  source_kind text;
  saved_at timestamptz := now();
begin
  select * into run from public.attendance_team_checks where id = p_id;
  if not found or run.uploaded_by is distinct from auth.uid()
    or not public.attendance_can_access_team(run.team_id, true) or run.period < public.attendance_retention_period() then
    raise exception 'Akses unggahan tim diperlukan.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(run.team_id::text || ':' || run.period, 0));
  select * into run from public.attendance_team_checks where id = p_id for update;
  if not found then raise exception 'Unggahan tidak ditemukan.' using errcode = 'P0002'; end if;
  if run.status = 'ready' then return run.completed_at; end if;
  if run.status <> 'uploading' then raise exception 'Rentang sudah diperbarui. Muat ulang kalender.' using errcode = '40001'; end if;

  if p_result->>'period' is distinct from run.period
    or p_result->>'start' is distinct from run.scan_start::text or p_result->>'end' is distinct from run.scan_end::text
    or jsonb_typeof(p_result->'days') is distinct from 'array' or jsonb_typeof(p_result->'employees') is distinct from 'array'
    or jsonb_typeof(p_result->'sources') is distinct from 'object' then
    raise exception 'Rentang hasil belum sesuai dengan unggahan.' using errcode = '22023';
  end if;
  if (select array_agg(d->>'key' order by d->>'key') from jsonb_array_elements(p_result->'days') d)
    is distinct from (select array_agg((run.scan_start + n)::text order by n)
      from generate_series(0, run.scan_end - run.scan_start) n) then
    raise exception 'Tanggal pada hasil pemeriksaan belum lengkap.' using errcode = '22023';
  end if;
  select count(*) into source_count from jsonb_object_keys(run.source_files);
  if source_count not between 2 and 3 or
    (select array_agg(k order by k) from jsonb_object_keys(run.source_files) k)
    is distinct from (select array_agg(k order by k) from jsonb_object_keys(p_result->'sources') k) then
    raise exception 'Pilih dua atau tiga file sumber yang sesuai.' using errcode = '22023';
  end if;

  select * into monthly from public.attendance_team_months where team_id = run.team_id and period = run.period;
  selected_roster := monthly.roster_id;
  selected_file := monthly.roster_file;
  selected_rows := monthly.roster_rows;
  if run.source_files ? 'roster' then
    if run.roster_id is not null then
      if selected_roster is distinct from run.roster_id or selected_file is distinct from run.source_files->'roster' then
        raise exception 'Roster bulan ini sudah berubah. Muat ulang periode.' using errcode = '40001';
      end if;
    else
      if selected_roster is not null then raise exception 'Roster bulan ini sudah tersimpan. Muat ulang periode.' using errcode = '40001'; end if;
      if jsonb_typeof(p_result->'rosterRows') is distinct from 'array' then
        raise exception 'Data Roster bulanan belum lengkap.' using errcode = '22023';
      end if;
      selected_roster := run.id;
      selected_file := run.source_files->'roster';
      selected_rows := p_result->'rosterRows';
    end if;
  elsif run.roster_id is not null then
    raise exception 'File Roster belum sesuai.' using errcode = '22023';
  end if;
  for source_kind in select jsonb_object_keys(run.source_files) loop
    if source_kind not in ('absensi', 'roster', 'finger') then raise exception 'File sumber belum valid.' using errcode = '22023'; end if;
    if source_kind = 'roster' and run.roster_id is not null then continue; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'validasi-absensi-tim'
      and name = run.team_id::text || '/' || run.id::text || '/' || source_kind) then
      raise exception 'Unggahan file belum lengkap. Coba simpan lagi.' using errcode = 'P0002';
    end if;
  end loop;

  select coalesce(monthly.coverage, '{}'::jsonb) || jsonb_object_agg((run.scan_start + n)::text, run.id::text)
    into coverage_days from generate_series(0, run.scan_end - run.scan_start) n;
  update public.attendance_team_checks set status = 'ready', result = p_result - 'rosterRows',
    totals = p_result->'totals', completed_at = saved_at where id = run.id;
  insert into public.attendance_team_months(team_id, period, roster_id, roster_file, roster_rows, coverage, updated_at)
    values (run.team_id, run.period, selected_roster, selected_file, selected_rows, coverage_days, saved_at)
    on conflict (team_id, period) do update set roster_id = excluded.roster_id, roster_file = excluded.roster_file,
      roster_rows = excluded.roster_rows, coverage = excluded.coverage, updated_at = excluded.updated_at;
  update public.attendance_team_checks c set status = 'replaced', result = null, totals = null
    where c.team_id = run.team_id and c.period = run.period and c.status = 'ready'
      and not exists (select 1 from jsonb_each_text(coverage_days) d where d.value = c.id::text);
  return saved_at;
end;
$$;

create table if not exists public.attendance_team_leave (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.attendance_teams(id),
  request_id uuid not null default gen_random_uuid(),
  request_no text not null default '',
  nik text not null check (length(btrim(nik)) > 0),
  kind text not null check (kind in ('CR', 'CT', 'CE')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  collected boolean not null default true,
  unique (team_id, nik, kind, start_date, end_date)
);
create index if not exists attendance_team_leave_request on public.attendance_team_leave(team_id, request_id);
create index if not exists attendance_team_leave_dates on public.attendance_team_leave(team_id, start_date, end_date);

create table if not exists public.attendance_team_permissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.attendance_teams(id),
  nik text not null check (length(btrim(nik)) > 0),
  code text not null check (length(btrim(code)) > 0 and code not in ('D', 'D2', 'D3', 'N3', 'L', 'CR', 'CS')),
  permit_date date not null,
  approved boolean not null default false,
  unique (team_id, nik, permit_date)
);
create index if not exists attendance_team_permission_dates on public.attendance_team_permissions(team_id, permit_date);

create table if not exists public.attendance_team_people (
  team_id uuid not null references public.attendance_teams(id),
  nik text not null check (length(btrim(nik)) > 0),
  grade_two_up boolean not null,
  primary key (team_id, nik)
);

create table if not exists public.attendance_team_reviews (
  team_id uuid not null references public.attendance_teams(id),
  nik text not null check (length(btrim(nik)) > 0),
  attendance_date date not null,
  basis text not null check (length(basis) between 1 and 12000),
  reviewed_by uuid default auth.uid() references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  primary key (team_id, nik, attendance_date)
);
create index if not exists attendance_team_review_dates on public.attendance_team_reviews(team_id, attendance_date);

alter table public.attendance_team_leave enable row level security;
alter table public.attendance_team_permissions enable row level security;
alter table public.attendance_team_people enable row level security;
alter table public.attendance_team_reviews enable row level security;
revoke all on public.attendance_team_leave, public.attendance_team_permissions, public.attendance_team_people, public.attendance_team_reviews
  from public, anon, authenticated;
grant select on public.attendance_team_leave, public.attendance_team_permissions, public.attendance_team_people, public.attendance_team_reviews
  to authenticated;
grant insert (team_id, nik, code, permit_date, approved), update (nik, code, permit_date, approved), delete
  on public.attendance_team_permissions to authenticated;

drop policy if exists attendance_team_leave_read on public.attendance_team_leave;
create policy attendance_team_leave_read on public.attendance_team_leave for select to authenticated
  using (public.attendance_can_access_team(team_id));
drop policy if exists attendance_team_permissions_read on public.attendance_team_permissions;
create policy attendance_team_permissions_read on public.attendance_team_permissions for select to authenticated
  using (public.attendance_can_access_team(team_id));
drop policy if exists attendance_team_permissions_write on public.attendance_team_permissions;
create policy attendance_team_permissions_write on public.attendance_team_permissions for all to authenticated
  using (public.attendance_can_access_team(team_id, true)) with check (public.attendance_can_access_team(team_id, true));
drop policy if exists attendance_team_people_read on public.attendance_team_people;
create policy attendance_team_people_read on public.attendance_team_people for select to authenticated
  using (public.attendance_can_access_team(team_id));
drop policy if exists attendance_team_people_write on public.attendance_team_people;
create policy attendance_team_people_write on public.attendance_team_people for all to authenticated
  using (public.attendance_can_access_team(team_id, true)) with check (public.attendance_can_access_team(team_id, true));
drop policy if exists attendance_team_reviews_read on public.attendance_team_reviews;
create policy attendance_team_reviews_read on public.attendance_team_reviews for select to authenticated
  using (to_char(attendance_date, 'YYYY-MM') >= public.attendance_retention_period() and public.attendance_can_access_team(team_id));

create or replace function public.attendance_set_grade(p_team uuid, p_nik text, p_grade boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.attendance_can_access_team(p_team, true) then
    raise exception 'Akses kelola absensi tim diperlukan.' using errcode = '42501';
  end if;
  insert into public.attendance_team_people(team_id, nik, grade_two_up) values (p_team, p_nik, p_grade)
    on conflict (team_id, nik) do update set grade_two_up = excluded.grade_two_up;
end;
$$;

create or replace function public.attendance_review_day(p_team uuid, p_nik text, p_date date, p_basis text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.attendance_can_access_team(p_team, true)
    or to_char(p_date, 'YYYY-MM') < public.attendance_retention_period() then
    raise exception 'Akses kelola absensi tim diperlukan.' using errcode = '42501';
  end if;
  if p_basis is null then
    delete from public.attendance_team_reviews where team_id = p_team and nik = p_nik and attendance_date = p_date;
    return;
  end if;
  insert into public.attendance_team_reviews(team_id, nik, attendance_date, basis, reviewed_by, reviewed_at)
    values (p_team, p_nik, p_date, p_basis, auth.uid(), now())
    on conflict (team_id, nik, attendance_date) do update set
      basis = excluded.basis, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
end;
$$;

create or replace function public.attendance_list_team_leave(p_team uuid, p_start date, p_end date)
returns table (id uuid, nik text, request_no text, collected boolean, segments jsonb)
language sql stable security invoker set search_path = ''
as $$
  select f.request_id, f.nik, f.request_no, f.collected,
    jsonb_agg(jsonb_build_object('kind', f.kind, 'start_date', f.start_date, 'end_date', f.end_date) order by f.start_date, f.kind)
  from public.attendance_team_leave f
  where f.team_id = p_team
    and exists (
      select 1 from public.attendance_team_leave d
      where d.team_id = f.team_id and d.request_id = f.request_id
        and d.start_date <= p_end and d.end_date >= p_start
    )
  group by f.request_id, f.nik, f.request_no, f.collected
$$;

create or replace function public.attendance_save_team_leave(p_team uuid, p_requests jsonb, p_delete_id uuid default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  request jsonb;
  request_key uuid;
  employee_nik text;
  submission_no text;
  is_collected boolean;
  entries jsonb;
  normalized_entries jsonb;
  saved_count integer := 0;
begin
  if not public.attendance_can_access_team(p_team, true) then
    raise exception 'Akses Form Cuti tim diperlukan.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance_leave:' || p_team::text, 0));

  if p_delete_id is not null then
    delete from public.attendance_team_leave f
    where f.team_id = p_team and f.request_id = p_delete_id;
    return 0;
  end if;

  if jsonb_typeof(p_requests) is distinct from 'array' then
    raise exception 'Daftar Form Cuti belum valid.' using errcode = '22023';
  end if;

  for request in select value from jsonb_array_elements(p_requests)
  loop
    request_key := nullif(request->>'id', '')::uuid;
    employee_nik := upper(regexp_replace(btrim(coalesce(request->>'nik', '')), '\s+', ' ', 'g'));
    submission_no := btrim(coalesce(request->>'request_no', ''));
    is_collected := coalesce((request->>'collected')::boolean, true);
    entries := request->'segments';
    if employee_nik = '' or jsonb_typeof(entries) is distinct from 'array' then
      raise exception 'Isi NIK dan rentang cuti.' using errcode = '22023';
    end if;
    if jsonb_array_length(entries) not between 1 and 3 then
      raise exception 'Isi rentang CR, CE, atau CT.' using errcode = '22023';
    end if;
    if (select count(distinct s.kind) from jsonb_to_recordset(entries) as s(kind text)) <> jsonb_array_length(entries) then
      raise exception 'Isi satu rentang untuk setiap jenis cuti pada pengajuan.' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('kind', s.kind, 'start_date', s.start_date, 'end_date', s.end_date) order by s.kind)
      into normalized_entries
    from jsonb_to_recordset(entries) as s(kind text, start_date date, end_date date);

    if request_key is not null then
      delete from public.attendance_team_leave f
      where f.team_id = p_team and f.request_id = request_key;
      if not found then
        raise exception 'Form Cuti sudah berubah. Muat ulang daftar.' using errcode = 'P0002';
      end if;
    else
      if exists (
        select 1 from public.attendance_team_leave f
        where f.team_id = p_team and f.nik = employee_nik and f.request_no = submission_no and f.collected = is_collected
        group by f.request_id
        having jsonb_agg(jsonb_build_object('kind', f.kind, 'start_date', f.start_date, 'end_date', f.end_date) order by f.kind)
          = normalized_entries
      ) then
        continue;
      end if;
      request_key := gen_random_uuid();
    end if;

    insert into public.attendance_team_leave (team_id, request_id, request_no, nik, kind, start_date, end_date, collected)
    select p_team, request_key, submission_no, employee_nik, s.kind, s.start_date, s.end_date, is_collected
    from jsonb_to_recordset(normalized_entries) as s(kind text, start_date date, end_date date);
    saved_count := saved_count + 1;
  end loop;

  return saved_count;
end;
$$;


revoke execute on function public.attendance_is_administrator(), public.attendance_manages_department(uuid),
  public.attendance_can_access_team(uuid, boolean), public.attendance_can_manage_team(uuid), public.attendance_retention_period(),
  public.attendance_workspace(), public.attendance_save_department(uuid, text), public.attendance_save_team(uuid, uuid, text),
  public.attendance_set_team_access(uuid, uuid, boolean), public.attendance_complete_team_check(uuid, jsonb),
  public.attendance_set_grade(uuid, text, boolean), public.attendance_review_day(uuid, text, date, text), public.attendance_list_team_leave(uuid, date, date),
  public.attendance_save_team_leave(uuid, jsonb, uuid), public.attendance_remove_stale_team_access()
  from public, anon, authenticated;
grant execute on function public.attendance_is_administrator(), public.attendance_manages_department(uuid),
  public.attendance_can_access_team(uuid, boolean), public.attendance_can_manage_team(uuid), public.attendance_retention_period(),
  public.attendance_workspace(), public.attendance_save_department(uuid, text), public.attendance_save_team(uuid, uuid, text),
  public.attendance_set_team_access(uuid, uuid, boolean), public.attendance_complete_team_check(uuid, jsonb),
  public.attendance_set_grade(uuid, text, boolean), public.attendance_review_day(uuid, text, date, text), public.attendance_list_team_leave(uuid, date, date),
  public.attendance_save_team_leave(uuid, jsonb, uuid) to authenticated;
-- The restrictive Storage policy also needs to evaluate anonymous requests.
revoke execute on function public.attendance_team_storage_allowed(text, boolean) from public, anon, authenticated;
grant execute on function public.attendance_team_storage_allowed(text, boolean) to anon, authenticated;
grant select on public.attendance_departments to service_role;

notify pgrst, 'reload schema';

commit;
