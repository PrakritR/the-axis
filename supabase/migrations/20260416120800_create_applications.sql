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
