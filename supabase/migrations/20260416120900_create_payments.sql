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
