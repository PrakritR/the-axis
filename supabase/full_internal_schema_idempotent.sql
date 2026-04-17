-- Combined Supabase schema bootstrap for AXIS internal cutover.
-- Generated from supabase/migrations in timestamp order.
-- Safe to run in Supabase SQL Editor.


-- ============================================================================
-- 20260416120000_create_app_users.sql
-- ============================================================================

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
drop policy if exists "app_users_select_own" on public.app_users;
create policy "app_users_select_own"
  on public.app_users
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists "app_users_update_own" on public.app_users;
create policy "app_users_update_own"
  on public.app_users
  for update
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

commit;

-- ============================================================================
-- 20260416120100_create_app_user_roles.sql
-- ============================================================================

-- Role assignments for internal app users (many roles per app_users row).

begin;

create table if not exists public.app_user_roles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  role text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint app_user_roles_role_check
    check (role = any (array['admin'::text, 'manager'::text, 'owner'::text, 'resident'::text])),
  constraint app_user_roles_user_role_uniq unique (app_user_id, role)
);

create index if not exists app_user_roles_app_user_id_idx on public.app_user_roles (app_user_id);
create index if not exists app_user_roles_role_idx on public.app_user_roles (role);

comment on table public.app_user_roles is 'One row per (app_user, role); is_primary enforces at most one primary per app_user via trigger.';

-- At most one primary role per app_user: before insert/update, clear other rows' is_primary.
create or replace function public._app_user_roles_clear_other_primary()
returns trigger
language plpgsql
as $$
begin
  if new.is_primary is true then
    update public.app_user_roles
    set is_primary = false
    where app_user_id = new.app_user_id
      and id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists app_user_roles_single_primary on public.app_user_roles;
create trigger app_user_roles_single_primary
  before insert or update on public.app_user_roles
  for each row
  execute procedure public._app_user_roles_clear_other_primary();

alter table public.app_user_roles enable row level security;

drop policy if exists "app_user_roles_select_own" on public.app_user_roles;
create policy "app_user_roles_select_own"
  on public.app_user_roles
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

-- ============================================================================
-- 20260416120200_create_admin_profiles.sql
-- ============================================================================

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

drop policy if exists "admin_profiles_select_own" on public.admin_profiles;
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

-- ============================================================================
-- 20260416120300_create_manager_profiles.sql
-- ============================================================================

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

drop policy if exists "manager_profiles_select_own" on public.manager_profiles;
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

-- ============================================================================
-- 20260416120400_create_owner_profiles.sql
-- ============================================================================

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

drop policy if exists "owner_profiles_select_own" on public.owner_profiles;
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

-- ============================================================================
-- 20260416120500_create_resident_profiles.sql
-- ============================================================================

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

drop policy if exists "resident_profiles_select_own" on public.resident_profiles;
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

-- ============================================================================
-- 20260416120600_create_properties.sql
-- ============================================================================

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
drop policy if exists "properties_select_manager" on public.properties;
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

drop policy if exists "properties_select_owner" on public.properties;
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

-- ============================================================================
-- 20260416120700_create_rooms.sql
-- ============================================================================

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
drop policy if exists "rooms_select_resident" on public.rooms;
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
drop policy if exists "rooms_select_manager" on public.rooms;
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
drop policy if exists "rooms_select_owner" on public.rooms;
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

-- ============================================================================
-- 20260416120800_create_applications.sql
-- ============================================================================

-- Applications: rental applications submitted by prospective residents.
-- Status transitions: draft → submitted → under_review → approved | rejected | cancelled
-- Duplicate prevention: partial unique index prevents two active applications
-- for the same (applicant, property, room, lease_start_date) slot.

begin;

create table if not exists public.applications (
  id                              uuid primary key default gen_random_uuid(),
  applicant_app_user_id           uuid not null references public.app_users (id) on delete cascade,
  property_id                     uuid not null references public.properties (id) on delete cascade,
  room_id                         uuid references public.rooms (id) on delete set null,

  -- signer info
  signer_full_name                text,
  signer_email                    text,
  signer_phone_number             text,
  signer_date_of_birth            date,
  signer_ssn_last4                text,
  signer_drivers_license_number   text,

  -- lease terms
  lease_term                      text,
  month_to_month                  boolean not null default false,
  lease_start_date                date,
  lease_end_date                  date,

  -- current address
  current_address                 text,
  current_city                    text,
  current_state                   text,
  current_zip                     text,

  -- employment
  employer_name                   text,
  employer_address                text,
  supervisor_name                 text,
  supervisor_phone                text,
  job_title                       text,
  monthly_income_cents            integer,
  annual_income_cents             integer,
  employment_start_date           date,
  other_income_notes              text,

  -- references
  reference_1_name                text,
  reference_1_relationship        text,
  reference_1_phone               text,
  reference_2_name                text,
  reference_2_relationship        text,
  reference_2_phone               text,

  -- occupancy
  number_of_occupants             integer,
  pets_notes                      text,
  eviction_history                text,
  bankruptcy_history              text,
  criminal_history                text,

  -- consent / signature
  has_cosigner                    boolean not null default false,
  consent_credit_background_check boolean not null default false,
  signer_signature                text,
  signer_date_signed              date,

  additional_notes                text,

  -- status
  status                          text not null default 'draft',
  approved                        boolean not null default false,
  rejected                        boolean not null default false,
  approved_at                     timestamptz,
  approved_unit_room              text,

  -- fee / payment tracking
  application_fee_paid            boolean not null default false,
  application_fee_due_cents       integer,
  stripe_checkout_session_id      text,
  stripe_payment_intent_id        text,

  -- lease doc tracking
  lease_token                     text,
  lease_status                    text,
  lease_signed                    boolean not null default false,
  lease_signed_date               date,
  lease_signature                 text,

  -- group application
  group_apply                     boolean not null default false,
  group_size                      integer,
  axis_group_id                   text,
  room_choice_2                   text,
  room_choice_3                   text,

  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint applications_status_check check (
    status = any (array[
      'draft'::text, 'submitted'::text, 'under_review'::text,
      'approved'::text, 'rejected'::text, 'cancelled'::text
    ])
  ),
  constraint applications_monthly_income_cents_check  check (monthly_income_cents  is null or monthly_income_cents  >= 0),
  constraint applications_annual_income_cents_check   check (annual_income_cents   is null or annual_income_cents   >= 0),
  constraint applications_fee_due_cents_check         check (application_fee_due_cents is null or application_fee_due_cents >= 0),
  constraint applications_number_of_occupants_check   check (number_of_occupants   is null or number_of_occupants   >= 0),
  constraint applications_group_size_check            check (group_size             is null or group_size             >= 0)
);

-- Indices
create index if not exists applications_applicant_idx    on public.applications (applicant_app_user_id);
create index if not exists applications_property_idx     on public.applications (property_id);
create index if not exists applications_room_idx         on public.applications (room_id) where room_id is not null;
create index if not exists applications_status_idx       on public.applications (status);

-- Duplicate prevention: one active application per (applicant, property, room, lease_start_date)
-- Only enforced when both room_id and lease_start_date are known to avoid false positives on drafts.
create unique index if not exists applications_unique_active_slot
  on public.applications (applicant_app_user_id, property_id, room_id, lease_start_date)
  where status not in ('rejected', 'cancelled')
    and room_id is not null
    and lease_start_date is not null;

comment on table public.applications is
  'Rental applications. status: draft | submitted | under_review | approved | rejected | cancelled. '
  'Duplicate guard: unique active slot per (applicant, property, room, lease_start_date).';

-- updated_at trigger
create or replace function public._applications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row
  execute procedure public._applications_set_updated_at();

alter table public.applications enable row level security;

-- Applicants can read their own applications.
drop policy if exists "applications_select_own" on public.applications;
create policy "applications_select_own"
  on public.applications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.app_users u
      where u.id = applicant_app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Managers can read applications for properties they manage.
drop policy if exists "applications_select_manager" on public.applications;
create policy "applications_select_manager"
  on public.applications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Owners can read applications for properties they own.
drop policy if exists "applications_select_owner" on public.applications;
create policy "applications_select_owner"
  on public.applications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.owned_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;

-- ============================================================================
-- 20260416120900_create_payments.sql
-- ============================================================================

-- Payments: internal ledger for all monetary transactions.
-- Replaces Airtable payment tracking for application fees, rent, deposits, etc.
-- Duplicate prevention via unique partial indices on axis_payment_key,
-- stripe_payment_intent_id, and stripe_checkout_session_id.

begin;

create table if not exists public.payments (
  id                          uuid primary key default gen_random_uuid(),
  app_user_id                 uuid references public.app_users (id) on delete set null,
  property_id                 uuid references public.properties (id) on delete set null,
  room_id                     uuid references public.rooms (id) on delete set null,
  application_id              uuid references public.applications (id) on delete set null,

  -- classification
  payment_type                text not null,
  category                    text,
  kind                        text,
  line_item_type              text,

  -- money (stored as cents to avoid float precision issues)
  amount_cents                integer not null,
  currency                    text not null default 'usd',

  -- status / timing
  status                      text not null default 'pending',
  due_date                    date,
  paid_at                     timestamptz,

  -- descriptions
  description                 text,
  notes                       text,

  -- stripe identifiers
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  stripe_charge_id            text,
  stripe_event_id             text,

  -- internal idempotency key (format: <type>_<reference_id> e.g. app_fee_<application_id>)
  axis_payment_key            text,

  -- snapshots for display without joins
  property_name_snapshot      text,
  room_number_snapshot        text,

  -- running balance (optional, set externally)
  balance_cents               integer,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint payments_amount_cents_check   check (amount_cents >= 0),
  constraint payments_balance_cents_check  check (balance_cents is null or balance_cents >= 0),
  constraint payments_status_check check (
    status = any (array[
      'pending'::text, 'completed'::text, 'failed'::text,
      'refunded'::text, 'cancelled'::text
    ])
  ),
  constraint payments_payment_type_check check (
    payment_type = any (array[
      'application_fee'::text, 'rent'::text, 'security_deposit'::text,
      'utilities'::text, 'service_fee'::text, 'other'::text
    ])
  )
);

-- Indices
create index if not exists payments_app_user_id_idx     on public.payments (app_user_id)    where app_user_id    is not null;
create index if not exists payments_property_id_idx     on public.payments (property_id)    where property_id    is not null;
create index if not exists payments_application_id_idx  on public.payments (application_id) where application_id is not null;
create index if not exists payments_status_idx          on public.payments (status);
create index if not exists payments_payment_type_idx    on public.payments (payment_type);

-- Duplicate prevention: unique per idempotency key / Stripe identifiers when present
create unique index if not exists payments_axis_payment_key_udx
  on public.payments (axis_payment_key)
  where axis_payment_key is not null;

create unique index if not exists payments_stripe_payment_intent_udx
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists payments_stripe_checkout_session_udx
  on public.payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

comment on table public.payments is
  'Internal payment ledger. payment_type: application_fee | rent | security_deposit | utilities | service_fee | other. '
  'status: pending | completed | failed | refunded | cancelled. '
  'axis_payment_key is the idempotency key for upsert operations.';

-- updated_at trigger
create or replace function public._payments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row
  execute procedure public._payments_set_updated_at();

alter table public.payments enable row level security;

-- Residents/applicants can read their own payments.
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
  on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Managers can read payments for properties they manage.
drop policy if exists "payments_select_manager" on public.payments;
create policy "payments_select_manager"
  on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Owners can read payments for properties they own.
drop policy if exists "payments_select_owner" on public.payments;
create policy "payments_select_owner"
  on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.owned_by_app_user_id
      where p.id = property_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;

-- ============================================================================
-- 20260416121000_create_file_metadata_tables.sql
-- ============================================================================

-- Internal file metadata for Supabase Storage (blobs live in Storage only).
-- Access: backend API uses service role; RLS enabled without policies = no direct PostgREST access for anon/auth.

begin;

-- ── lease_files (private bucket: leases) ───────────────────────────────────
-- Paths use application_id scope until a dedicated internal leases table exists.

create table if not exists public.lease_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  lease_id uuid,
  storage_bucket text not null default 'leases',
  storage_path text not null,
  file_kind text not null default 'attachment',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_files_bucket_check check (storage_bucket = 'leases'),
  constraint lease_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint lease_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists lease_files_application_id_idx on public.lease_files (application_id);

-- ── application_files (private bucket: application documents) ─────────────

create table if not exists public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  storage_bucket text not null default 'application documents',
  storage_path text not null,
  document_kind text not null default 'other',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_files_bucket_check check (storage_bucket = 'application documents'),
  constraint application_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint application_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists application_files_application_id_idx on public.application_files (application_id);

-- ── property_images (public buckets: property-images | bathroom-images | shared-space-image) ──

create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  bathroom_id uuid,
  shared_space_id uuid,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  alt_text text,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_images_bucket_check check (
    storage_bucket = any (
      array['property-images'::text, 'bathroom-images'::text, 'shared-space-image'::text]
    )
  ),
  constraint property_images_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint property_images_context_check check (
    (storage_bucket = 'property-images' and bathroom_id is null and shared_space_id is null)
    or (storage_bucket = 'bathroom-images' and bathroom_id is not null and shared_space_id is null)
    or (storage_bucket = 'shared-space-image' and shared_space_id is not null and bathroom_id is null)
  ),
  constraint property_images_unique_path unique (storage_bucket, storage_path)
);

create index if not exists property_images_property_id_idx on public.property_images (property_id);

-- ── room_images (public bucket: room-image) ──────────────────────────────

create table if not exists public.room_images (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  storage_bucket text not null default 'room-image',
  storage_path text not null,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  alt_text text,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_images_bucket_check check (storage_bucket = 'room-image'),
  constraint room_images_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint room_images_unique_path unique (storage_bucket, storage_path)
);

create index if not exists room_images_room_id_idx on public.room_images (room_id);

-- ── work_order_files (private bucket: work-order-images) ───────────────────
-- work_order_id is not FK yet (internal work_orders table pending).

create table if not exists public.work_order_files (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  storage_bucket text not null default 'work-order-images',
  storage_path text not null,
  file_kind text not null default 'image',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_files_bucket_check check (storage_bucket = 'work-order-images'),
  constraint work_order_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint work_order_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists work_order_files_work_order_id_idx on public.work_order_files (work_order_id);

-- updated_at triggers (same pattern as other internal tables)

create or replace function public._lease_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists lease_files_set_updated_at on public.lease_files;
create trigger lease_files_set_updated_at before update on public.lease_files
  for each row execute procedure public._lease_files_set_updated_at();

create or replace function public._application_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists application_files_set_updated_at on public.application_files;
create trigger application_files_set_updated_at before update on public.application_files
  for each row execute procedure public._application_files_set_updated_at();

create or replace function public._property_images_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists property_images_set_updated_at on public.property_images;
create trigger property_images_set_updated_at before update on public.property_images
  for each row execute procedure public._property_images_set_updated_at();

create or replace function public._room_images_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists room_images_set_updated_at on public.room_images;
create trigger room_images_set_updated_at before update on public.room_images
  for each row execute procedure public._room_images_set_updated_at();

create or replace function public._work_order_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists work_order_files_set_updated_at on public.work_order_files;
create trigger work_order_files_set_updated_at before update on public.work_order_files
  for each row execute procedure public._work_order_files_set_updated_at();

alter table public.lease_files enable row level security;
alter table public.application_files enable row level security;
alter table public.property_images enable row level security;
alter table public.room_images enable row level security;
alter table public.work_order_files enable row level security;

comment on table public.lease_files is 'Supabase Storage metadata — bucket leases (private).';
comment on table public.application_files is 'Supabase Storage metadata — bucket application documents (private).';
comment on table public.property_images is 'Listing images — buckets property-images | bathroom-images | shared-space-image (public).';
comment on table public.room_images is 'Room listing images — bucket room-image (public).';
comment on table public.work_order_files is 'Work order uploads — bucket work-order-images (private). work_order_id FK pending.';

commit;

-- ============================================================================
-- 20260416121100_alter_work_order_files_id_text.sql
-- ============================================================================

-- Work order rows still live in Airtable (rec…); store that id in metadata until internal work_orders exists.

begin;

alter table public.work_order_files
  alter column work_order_id type text using work_order_id::text;

comment on column public.work_order_files.work_order_id is 'Airtable Work Orders record id (rec…) or future internal UUID.';

commit;

-- ============================================================================
-- 20260416121300_properties_legacy_id_manager_availability.sql
-- ============================================================================

begin;

-- Optional link from Postgres property → legacy Airtable Properties row (migration / dedupe).
alter table public.properties
  add column if not exists legacy_airtable_record_id text;

comment on column public.properties.legacy_airtable_record_id is
  'When set, Airtable Properties record id (rec…) for the same listing; internal-only rows leave null.';

create index if not exists properties_legacy_airtable_record_id_idx
  on public.properties (legacy_airtable_record_id)
  where legacy_airtable_record_id is not null;

-- Manager tour availability (30-minute slots), Postgres-first — replaces Airtable Manager Availability for UUID properties.
create table if not exists public.manager_availability (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  created_by_app_user_id uuid references public.app_users (id) on delete set null,
  slot_date date,
  weekday_abbr text,
  is_recurring boolean not null default false,
  recurrence_start date,
  slot_start_minutes integer not null,
  slot_end_minutes integer not null,
  time_slot_label text,
  status text not null default 'available',
  timezone text not null default 'UTC',
  source text not null default 'manager_portal',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint manager_availability_slot_bounds check (
    slot_start_minutes >= 0
    and slot_start_minutes < 24 * 60
    and slot_end_minutes > slot_start_minutes
    and slot_end_minutes <= 24 * 60
  )
);

create index if not exists manager_availability_property_id_idx
  on public.manager_availability (property_id);

create index if not exists manager_availability_property_date_idx
  on public.manager_availability (property_id, slot_date)
  where is_recurring = false;

create index if not exists manager_availability_property_weekday_idx
  on public.manager_availability (property_id, weekday_abbr)
  where is_recurring = true;

comment on table public.manager_availability is
  'Per-property tour availability (30-min slots). Backend uses service role; RLS enabled without policies.';

alter table public.manager_availability enable row level security;

commit;

-- ============================================================================
-- 20260416121400_scheduled_events.sql
-- ============================================================================

begin;

-- Internal scheduling: tours, meetings, etc. Replaces Airtable Scheduling writes for Postgres-first flows.
create table if not exists public.scheduled_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('tour', 'meeting')),
  property_id uuid references public.properties (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  manager_app_user_id uuid references public.app_users (id) on delete set null,
  created_by_app_user_id uuid references public.app_users (id) on delete set null,
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'UTC',
  preferred_date date,
  preferred_time_label text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'completed', 'no_show')),
  source text not null default 'unknown',
  notes text,
  resident_app_user_id uuid references public.app_users (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  inquiry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_events_time_order check (end_at > start_at)
);

comment on table public.scheduled_events is
  'Portal and public bookings (tours, meetings). Service role from API; RLS enabled without policies.';

create index if not exists scheduled_events_property_id_idx
  on public.scheduled_events (property_id)
  where property_id is not null;

create index if not exists scheduled_events_manager_app_user_id_idx
  on public.scheduled_events (manager_app_user_id)
  where manager_app_user_id is not null;

create index if not exists scheduled_events_start_at_idx
  on public.scheduled_events (start_at);

create index if not exists scheduled_events_preferred_date_idx
  on public.scheduled_events (preferred_date)
  where preferred_date is not null;

create index if not exists scheduled_events_status_idx
  on public.scheduled_events (status);

alter table public.scheduled_events enable row level security;

commit;

-- ============================================================================
-- 20260416121600_admin_meeting_availability.sql
-- ============================================================================

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

drop policy if exists "admin_meeting_availability_select_own" on public.admin_meeting_availability;
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

drop policy if exists "admin_meeting_availability_insert_own" on public.admin_meeting_availability;
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

drop policy if exists "admin_meeting_availability_update_own" on public.admin_meeting_availability;
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

drop policy if exists "admin_meeting_availability_delete_own" on public.admin_meeting_availability;
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

-- ============================================================================
-- 20260416121700_create_manager_onboarding.sql
-- ============================================================================

begin;

create table if not exists public.manager_onboarding (
  id uuid primary key default gen_random_uuid(),
  manager_id text not null unique,
  email text not null unique,
  full_name text,
  phone_number text,
  plan_type text not null default 'free',
  billing_interval text not null default 'free',
  onboarding_source text,
  stripe_checkout_session_id text,
  account_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_onboarding_plan_type_check
    check (plan_type = any (array['free'::text, 'pro'::text, 'business'::text])),
  constraint manager_onboarding_billing_interval_check
    check (billing_interval = any (array['free'::text, 'waived'::text, 'monthly'::text, 'annual'::text])),
  constraint manager_onboarding_email_lower_check
    check (email = lower(email))
);

create index if not exists manager_onboarding_manager_id_idx on public.manager_onboarding (manager_id);
create index if not exists manager_onboarding_email_idx on public.manager_onboarding (email);

comment on table public.manager_onboarding is
  'Pre-auth manager onboarding records used for pricing, checkout completion, and portal account bootstrap.';

create or replace function public._manager_onboarding_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists manager_onboarding_set_updated_at on public.manager_onboarding;
create trigger manager_onboarding_set_updated_at
  before update on public.manager_onboarding
  for each row
  execute procedure public._manager_onboarding_set_updated_at();

alter table public.manager_onboarding enable row level security;

commit;
