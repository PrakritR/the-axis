-- Rooms table: individual rentable units within a property.
-- Each room belongs to exactly one property.

begin;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null
    references public.properties (id) on delete cascade,
  name text not null,
  description text,
  monthly_rent_cents integer not null default 0,
  utility_fee_cents integer not null default 0,
  occupied_by_app_user_id uuid
    references public.app_users (id) on delete set null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_monthly_rent_cents_check check (monthly_rent_cents >= 0),
  constraint rooms_utility_fee_cents_check check (utility_fee_cents >= 0)
);

create index if not exists rooms_property_id_idx on public.rooms (property_id);
create index if not exists rooms_occupied_by_app_user_id_idx on public.rooms (occupied_by_app_user_id)
  where occupied_by_app_user_id is not null;
create index if not exists rooms_active_idx on public.rooms (active);

comment on table public.rooms is 'Rentable units within a property. Rent/fee stored as cents.';

create or replace function public._rooms_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row
  execute procedure public._rooms_set_updated_at();

alter table public.rooms enable row level security;

-- Residents can see the room they occupy.
create policy "rooms_select_resident"
  on public.rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = occupied_by_app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Managers can see rooms belonging to properties they manage.
create policy "rooms_select_manager"
  on public.rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Owners can see rooms in properties they own.
create policy "rooms_select_owner"
  on public.rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      join public.app_users u on u.id = p.owned_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;
