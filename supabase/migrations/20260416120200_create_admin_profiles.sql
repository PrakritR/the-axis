-- Admin-specific profile extension for app_users (Airtable migration path).
-- One row per app_user; only admins should have rows (enforced in application code).

begin;

create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_profiles_app_user_id_key unique (app_user_id)
);

create index if not exists admin_profiles_app_user_id_idx on public.admin_profiles (app_user_id);

comment on table public.admin_profiles is 'Optional admin-only fields; 1:1 with app_users when present. Caller must ensure app_user has admin role.';

create or replace function public._admin_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_profiles_set_updated_at on public.admin_profiles;
create trigger admin_profiles_set_updated_at
  before update on public.admin_profiles
  for each row
  execute procedure public._admin_profiles_set_updated_at();

alter table public.admin_profiles enable row level security;

create policy "admin_profiles_select_own"
  on public.admin_profiles
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
