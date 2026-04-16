-- Internal app user profiles (Airtable migration path).
-- One row per Supabase Auth user; auth_user_id = auth.users.id.

begin;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique
    references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_key unique (email)
);

create index if not exists app_users_auth_user_id_idx on public.app_users (auth_user_id);

comment on table public.app_users is 'Application user row linked 1:1 to auth.users; separate from Auth metadata.';

-- Keep updated_at fresh on row changes (created_at stays at insert time).
create or replace function public._app_users_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
  before update on public.app_users
  for each row
  execute procedure public._app_users_set_updated_at();

alter table public.app_users enable row level security;

-- Authenticated users may read/update only their own profile row.
-- Inserts/upserts from trusted server code should use the service role key (bypasses RLS).
create policy "app_users_select_own"
  on public.app_users
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

create policy "app_users_update_own"
  on public.app_users
  for update
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

commit;
