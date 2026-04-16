-- Properties table: physical rental properties managed through AXIS.
-- owned_by_app_user_id: links to an app_user with 'owner' role (null = AXIS-owned).
-- managed_by_app_user_id: links to an app_user with 'manager' role.

begin;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  zip text not null,
  ownership_type text not null default 'Personal',
  owned_by_app_user_id uuid
    references public.app_users (id) on delete set null,
  managed_by_app_user_id uuid
    references public.app_users (id) on delete set null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_ownership_type_check check (
    ownership_type = any (array['Personal'::text, 'Third-Party Managed'::text])
  )
);

create index if not exists properties_owned_by_app_user_id_idx on public.properties (owned_by_app_user_id)
  where owned_by_app_user_id is not null;
create index if not exists properties_managed_by_app_user_id_idx on public.properties (managed_by_app_user_id)
  where managed_by_app_user_id is not null;
create index if not exists properties_active_idx on public.properties (active);

comment on table public.properties is 'Physical rental properties. ownership_type: Personal | Third-Party Managed.';

create or replace function public._properties_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
  before update on public.properties
  for each row
  execute procedure public._properties_set_updated_at();

alter table public.properties enable row level security;

-- Managers can select properties they manage; owners can select their own.
create policy "properties_select_manager"
  on public.properties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = managed_by_app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "properties_select_owner"
  on public.properties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = owned_by_app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;
