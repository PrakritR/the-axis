begin;

-- Weekly meeting windows per admin (portal + public booking). Mirrors manager_availability intent
-- (recurring weekday + minute ranges) but scoped to app_users (no property).

create table if not exists public.admin_meeting_availability (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  day_of_week integer not null
    check (day_of_week >= 0 and day_of_week <= 6),
  start_minute integer not null,
  end_minute integer not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_meeting_availability_slot_bounds check (
    start_minute >= 0
    and start_minute < 24 * 60
    and end_minute > start_minute
    and end_minute <= 24 * 60
  )
);

create index if not exists admin_meeting_availability_app_user_day_idx
  on public.admin_meeting_availability (app_user_id, day_of_week);

comment on table public.admin_meeting_availability is
  'Recurring weekly meeting availability per admin (day_of_week matches JS Date.getDay(): 0=Sun).';

create or replace function public._admin_meeting_availability_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_meeting_availability_set_updated_at on public.admin_meeting_availability;
create trigger admin_meeting_availability_set_updated_at
  before update on public.admin_meeting_availability
  for each row
  execute procedure public._admin_meeting_availability_set_updated_at();

alter table public.admin_meeting_availability enable row level security;

create policy "admin_meeting_availability_select_own"
  on public.admin_meeting_availability
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "admin_meeting_availability_insert_own"
  on public.admin_meeting_availability
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "admin_meeting_availability_update_own"
  on public.admin_meeting_availability
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "admin_meeting_availability_delete_own"
  on public.admin_meeting_availability
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;
