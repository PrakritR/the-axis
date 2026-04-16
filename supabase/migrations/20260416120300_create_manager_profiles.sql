-- Manager-specific profile extension for app_users (Airtable migration path).
-- One row per app_user; only managers should have rows (enforced in application code).

begin;

create table if not exists public.manager_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  company text,
  tier text,
  phone_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_profiles_app_user_id_key unique (app_user_id),
  constraint manager_profiles_tier_check check (
    tier is null or tier = any (array['Standard'::text, 'Premium'::text])
  )
);

create index if not exists manager_profiles_app_user_id_idx on public.manager_profiles (app_user_id);

comment on table public.manager_profiles is 'Optional manager-only fields; 1:1 with app_users when present. tier: Standard | Premium.';

create or replace function public._manager_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists manager_profiles_set_updated_at on public.manager_profiles;
create trigger manager_profiles_set_updated_at
  before update on public.manager_profiles
  for each row
  execute procedure public._manager_profiles_set_updated_at();

alter table public.manager_profiles enable row level security;

create policy "manager_profiles_select_own"
  on public.manager_profiles
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
