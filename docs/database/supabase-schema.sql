-- Axis Seattle Resident Portal Schema
-- Run this in Supabase → SQL Editor

create table if not exists work_orders (
  id uuid default gen_random_uuid() primary key,
  resident_id uuid references auth.users(id) on delete cascade,
  resident_email text,
  category text,
  title text not null,
  description text not null,
  priority text default 'normal',
  status text default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists work_order_messages (
  id uuid default gen_random_uuid() primary key,
  work_order_id uuid references work_orders(id) on delete cascade,
  sender_id uuid,
  sender_email text,
  is_admin boolean default false,
  message text not null,
  created_at timestamptz default now()
);

-- Enable realtime
alter publication supabase_realtime add table work_order_messages;

-- Row level security
alter table work_orders enable row level security;
alter table work_order_messages enable row level security;

-- Residents can manage their own work orders
create policy "residents_own_orders" on work_orders
  for all using (auth.uid() = resident_id)
  with check (auth.uid() = resident_id);

-- Residents can read/write messages on their own work orders
create policy "residents_own_messages" on work_order_messages
  for all using (
    exists (
      select 1 from work_orders
      where id = work_order_id and resident_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from work_orders
      where id = work_order_id and resident_id = auth.uid()
    )
  );

-- ── app_users (internal profiles; source of truth: supabase/migrations/20260416120000_create_app_users.sql) ──
-- One row per auth user. Linked via auth_user_id -> auth.users(id).
-- create table public.app_users (
--   id uuid primary key default gen_random_uuid(),
--   auth_user_id uuid not null unique references auth.users(id) on delete cascade,
--   email text not null unique,
--   full_name text,
--   phone text,
--   is_active boolean not null default true,
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now()
-- );

-- app_user_roles: see supabase/migrations/20260416120100_create_app_user_roles.sql
-- (app_user_id -> app_users.id, role in admin|manager|owner|resident, unique (app_user_id, role))
-- Example SQL to grant admin: supabase/seed-examples/assign_admin_role_by_email.sql
-- Or: ADMIN_SEED_EMAIL=... npm run seed:admin-role

-- admin_profiles: see supabase/migrations/20260416120200_create_admin_profiles.sql
-- (app_user_id -> app_users.id, unique app_user_id; backend/server/lib/admin-profiles-service.js)
-- HTTP: GET|POST|PATCH /api/admin-profiles (Bearer JWT, admin role, service-role writes) — backend/server/handlers/admin-profiles.js
