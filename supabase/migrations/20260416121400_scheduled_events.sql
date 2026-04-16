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
