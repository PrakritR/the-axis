-- Owner-specific profile extension for app_users (Airtable migration path).
-- One row per app_user; only owners should have rows (enforced in application code).
-- Stripe Connect columns are optional until onboarding is wired.

begin;

create table if not exists public.owner_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  phone_number text,
  notes text,
  stripe_connect_account_id text,
  stripe_onboarding_complete boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  stripe_charges_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_profiles_app_user_id_key unique (app_user_id)
);

create index if not exists owner_profiles_app_user_id_idx on public.owner_profiles (app_user_id);
create index if not exists owner_profiles_stripe_connect_account_id_idx
  on public.owner_profiles (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

comment on table public.owner_profiles is 'Optional owner-only fields; Stripe Connect readiness columns for future use.';

create or replace function public._owner_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists owner_profiles_set_updated_at on public.owner_profiles;
create trigger owner_profiles_set_updated_at
  before update on public.owner_profiles
  for each row
  execute procedure public._owner_profiles_set_updated_at();

alter table public.owner_profiles enable row level security;

create policy "owner_profiles_select_own"
  on public.owner_profiles
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
