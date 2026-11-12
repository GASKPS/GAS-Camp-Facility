begin;

-- Keep existing accounts, department assignments and Sub Departemen grants.
update public.attendance_accounts set role = 'department_admin' where role = 'team_admin';
alter table public.attendance_accounts drop constraint if exists attendance_accounts_role_check;
alter table public.attendance_accounts add constraint attendance_accounts_role_check
  check (role in ('administrator', 'department_admin'));

drop policy if exists attendance_accounts_read on public.attendance_accounts;
create policy attendance_accounts_read on public.attendance_accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.attendance_is_administrator());
drop policy if exists attendance_teams_read on public.attendance_teams;
create policy attendance_teams_read on public.attendance_teams for select to authenticated
  using (public.attendance_can_access_team(id));
drop policy if exists attendance_access_read on public.attendance_team_access;
create policy attendance_access_read on public.attendance_team_access for select to authenticated
  using (public.attendance_is_administrator() or (user_id = (select auth.uid()) and public.attendance_can_access_team(team_id)));

create or replace function public.attendance_save_team(p_id uuid, p_department uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare saved uuid;
begin
  if not public.attendance_manages_department(p_department) then
    raise exception 'Akses Departemen diperlukan.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.attendance_teams(department_id, name) values (p_department, btrim(p_name)) returning id into saved;
    if not public.attendance_is_administrator() then
      insert into public.attendance_team_access(team_id, user_id) values (saved, auth.uid());
    end if;
  else
    if not (public.attendance_is_administrator() or public.attendance_can_access_team(p_id, true)) then
      raise exception 'Akses Sub Departemen diperlukan.' using errcode = '42501';
    end if;
    update public.attendance_teams set name = btrim(p_name) where id = p_id and department_id = p_department returning id into saved;
  end if;
  if saved is null then raise exception 'Sub Departemen tidak ditemukan.' using errcode = 'P0002'; end if;
  return saved;
end;
$$;

create or replace function public.attendance_set_team_access(p_team uuid, p_user uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.attendance_is_administrator() then
    raise exception 'Akses Administrator diperlukan.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.attendance_accounts a join public.attendance_teams t on t.department_id = a.department_id
    where a.user_id = p_user and t.id = p_team
  ) then raise exception 'Pilih akun dari Departemen yang menaungi Sub Departemen ini.' using errcode = '22023'; end if;
  if p_enabled then
    insert into public.attendance_team_access(team_id, user_id) values (p_team, p_user) on conflict do nothing;
  else
    delete from public.attendance_team_access where team_id = p_team and user_id = p_user;
  end if;
end;
$$;

create table if not exists public.attendance_team_activity (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  team_id uuid not null references public.attendance_teams(id),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  action text not null check (action in ('upload', 'correction', 'review', 'undo_review')),
  actor_email text not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  corrected_dates date[] not null default '{}',
  nik text,
  occurred_at timestamptz not null
);
create index if not exists attendance_team_activity_timeline on public.attendance_team_activity(team_id, occurred_at desc, id desc);
create index if not exists attendance_team_activity_period on public.attendance_team_activity(period);
alter table public.attendance_team_activity enable row level security;
revoke all on public.attendance_team_activity from public, anon, authenticated;
grant select on public.attendance_team_activity to authenticated;
drop policy if exists attendance_team_activity_read on public.attendance_team_activity;
create policy attendance_team_activity_read on public.attendance_team_activity for select to authenticated
  using (period >= public.attendance_retention_period() and public.attendance_can_access_team(team_id));

create or replace function public.attendance_log_completed_upload()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor text;
  corrected date[];
begin
  select email into actor from public.attendance_accounts where user_id = new.uploaded_by;
  -- Completion updates the upload before replacing the month's date pointers.
  select array(
    select new.scan_start + n from generate_series(0, new.scan_end - new.scan_start) n
    join public.attendance_team_months m on m.team_id = new.team_id and m.period = new.period
      and m.coverage ? ((new.scan_start + n)::text)
    order by n
  ) into corrected;
  insert into public.attendance_team_activity(event_key, team_id, period, action, actor_email, start_date, end_date, corrected_dates, occurred_at)
  values ('upload:' || new.id::text, new.team_id, new.period,
    case when cardinality(corrected) > 0 then 'correction' else 'upload' end,
    coalesce(actor, 'Akun arsip'), new.scan_start, new.scan_end, corrected, new.completed_at)
  on conflict (event_key) do nothing;
  return new;
end;
$$;
drop trigger if exists attendance_log_completed_upload on public.attendance_team_checks;
create trigger attendance_log_completed_upload after update of status on public.attendance_team_checks
  for each row when (old.status = 'uploading' and new.status = 'ready')
  execute function public.attendance_log_completed_upload();

create or replace function public.attendance_log_review_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor text;
  entry public.attendance_team_reviews%rowtype;
  verb text;
  event_time timestamptz;
begin
  select email into actor from public.attendance_accounts where user_id = auth.uid() and active;
  if actor is null then return null; end if;
  if tg_op = 'UPDATE' and old.basis is not distinct from new.basis
    and old.reviewed_by is not distinct from new.reviewed_by then return null; end if;
  if tg_op = 'DELETE' then
    entry := old;
    verb := 'undo_review';
    event_time := now();
  else
    entry := new;
    verb := 'review';
    event_time := new.reviewed_at;
  end if;
  insert into public.attendance_team_activity(event_key, team_id, period, action, actor_email, start_date, end_date, nik, occurred_at)
  values (verb || ':' || jsonb_build_array(entry.team_id, entry.nik, entry.attendance_date, extract(epoch from event_time))::text,
    entry.team_id, to_char(entry.attendance_date, 'YYYY-MM'), verb, actor, entry.attendance_date,
    entry.attendance_date, entry.nik, event_time)
  on conflict (event_key) do nothing;
  return null;
end;
$$;
drop trigger if exists attendance_log_review_change on public.attendance_team_reviews;
create trigger attendance_log_review_change after insert or update of basis, reviewed_by or delete on public.attendance_team_reviews
  for each row execute function public.attendance_log_review_change();

-- Backfill the upload and review events for which the current archive still has records.
insert into public.attendance_team_activity(event_key, team_id, period, action, actor_email, start_date, end_date, occurred_at)
  select 'upload:' || c.id::text, c.team_id, c.period, 'upload', coalesce(a.email, 'Akun arsip'),
    c.scan_start, c.scan_end, c.completed_at
  from public.attendance_team_checks c left join public.attendance_accounts a on a.user_id = c.uploaded_by
  where c.completed_at is not null and c.period >= public.attendance_retention_period()
  on conflict (event_key) do nothing;
insert into public.attendance_team_activity(event_key, team_id, period, action, actor_email, start_date, end_date, nik, occurred_at)
  select 'review:' || jsonb_build_array(r.team_id, r.nik, r.attendance_date, extract(epoch from r.reviewed_at))::text,
    r.team_id, to_char(r.attendance_date, 'YYYY-MM'), 'review', coalesce(a.email, 'Akun arsip'),
    r.attendance_date, r.attendance_date, r.nik, r.reviewed_at
  from public.attendance_team_reviews r left join public.attendance_accounts a on a.user_id = r.reviewed_by
  where to_char(r.attendance_date, 'YYYY-MM') >= public.attendance_retention_period()
  on conflict (event_key) do nothing;

create or replace function public.attendance_trim_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.attendance_team_activity where period < public.attendance_retention_period();
  return null;
end;
$$;
-- The existing retention job deletes expired monthly archives once per run.
drop trigger if exists attendance_trim_activity on public.attendance_team_months;
create trigger attendance_trim_activity after delete on public.attendance_team_months
  for each statement execute function public.attendance_trim_activity();

revoke execute on function public.attendance_log_completed_upload(), public.attendance_log_review_change(),
  public.attendance_trim_activity() from public, anon, authenticated;
notify pgrst, 'reload schema';

commit;
