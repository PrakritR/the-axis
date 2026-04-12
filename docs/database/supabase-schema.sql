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
