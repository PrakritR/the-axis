-- Resident-specific profile extension for app_users.
-- One row per app_user; only residents should have rows (enforced in application code).

begin;

create table if not exists public.resident_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  phone_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resident_profiles_app_user_id_key unique (app_user_id)
);

create index if not exists resident_profiles_app_user_id_idx on public.resident_profiles (app_user_id);

comment on table public.resident_profiles is 'Optional resident-only fields; 1:1 with app_users when present.';

create or replace function public._resident_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists resident_profiles_set_updated_at on public.resident_profiles;
create trigger resident_profiles_set_updated_at
  before update on public.resident_profiles
  for each row
  execute procedure public._resident_profiles_set_updated_at();

alter table public.resident_profiles enable row level security;

create policy "resident_profiles_select_own"
  on public.resident_profiles
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

commit;
