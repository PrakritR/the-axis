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
