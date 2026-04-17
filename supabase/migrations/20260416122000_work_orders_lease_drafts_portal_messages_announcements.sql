-- Core tables to replace remaining Airtable entities: work orders, lease drafts workflow,
-- portal messaging, announcements. RLS mirrors existing patterns (applications/properties).
-- Backend handlers should continue using the service role for privileged writes where needed.

begin;

-- ── lease_drafts (replaces Airtable Lease Drafts for an application) ─────────
create table if not exists public.lease_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  resident_app_user_id uuid references public.app_users (id) on delete set null,
  status text not null default 'draft',
  lease_token text unique,
  lease_html text,
  lease_json jsonb,
  allow_sign_without_move_in_pay boolean not null default false,
  manager_signature_text text,
  manager_signed_at timestamptz,
  manager_signature_image_url text,
  published_at timestamptz,
  resident_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_drafts_status_check check (
    status = any (array[
      'draft'::text, 'pending_review'::text, 'published'::text,
      'signed'::text, 'archived'::text, 'cancelled'::text
    ])
  )
);

create index if not exists lease_drafts_application_id_idx on public.lease_drafts (application_id);
create index if not exists lease_drafts_property_id_idx on public.lease_drafts (property_id);
create index if not exists lease_drafts_resident_app_user_id_idx on public.lease_drafts (resident_app_user_id)
  where resident_app_user_id is not null;

comment on table public.lease_drafts is 'Lease document drafts per application; PDFs use lease_files / Storage.';

create or replace function public._lease_drafts_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists lease_drafts_set_updated_at on public.lease_drafts;
create trigger lease_drafts_set_updated_at before update on public.lease_drafts
  for each row execute procedure public._lease_drafts_set_updated_at();

alter table public.lease_drafts enable row level security;

create policy "lease_drafts_select_applicant"
  on public.lease_drafts for select to authenticated using (
    exists (
      select 1 from public.applications a
      join public.app_users u on u.id = a.applicant_app_user_id
      where a.id = application_id and u.auth_user_id = auth.uid()
    )
  );

create policy "lease_drafts_select_manager_property"
  on public.lease_drafts for select to authenticated using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  );

create policy "lease_drafts_select_admin"
  on public.lease_drafts for select to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "lease_drafts_insert_manager_property"
  on public.lease_drafts for insert to authenticated with check (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  );

create policy "lease_drafts_update_manager_property"
  on public.lease_drafts for update to authenticated using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  );

create policy "lease_drafts_update_admin"
  on public.lease_drafts for update to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

-- ── work_orders ──────────────────────────────────────────────────────────────
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  resident_app_user_id uuid not null references public.app_users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  category text not null default 'General Maintenance',
  urgency text not null default 'Medium',
  description text not null default '',
  preferred_time_window text,
  status text not null default 'open',
  resolved boolean not null default false,
  management_notes text,
  resolution_summary text,
  last_update_at timestamptz,
  scheduled_visit_date date,
  scheduled_visit_window text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_urgency_check check (
    urgency = any (array['Low'::text, 'Medium'::text, 'Urgent'::text])
  ),
  constraint work_orders_status_check check (
    status = any (array[
      'open'::text, 'in_progress'::text, 'scheduled'::text,
      'resolved'::text, 'closed'::text, 'cancelled'::text
    ])
  )
);

create index if not exists work_orders_resident_idx on public.work_orders (resident_app_user_id);
create index if not exists work_orders_property_idx on public.work_orders (property_id);
create index if not exists work_orders_status_idx on public.work_orders (status);

comment on table public.work_orders is 'Maintenance requests; files in work_order_files (storage + metadata).';

create or replace function public._work_orders_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at before update on public.work_orders
  for each row execute procedure public._work_orders_set_updated_at();

alter table public.work_orders enable row level security;

create policy "work_orders_select_own_resident"
  on public.work_orders for select to authenticated using (
    exists (
      select 1 from public.app_users u
      where u.id = resident_app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "work_orders_select_manager_property"
  on public.work_orders for select to authenticated using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  );

create policy "work_orders_select_admin"
  on public.work_orders for select to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "work_orders_insert_own_resident"
  on public.work_orders for insert to authenticated with check (
    exists (
      select 1 from public.app_users u
      where u.id = resident_app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "work_orders_update_own_resident"
  on public.work_orders for update to authenticated using (
    exists (
      select 1 from public.app_users u
      where u.id = resident_app_user_id and u.auth_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.app_users u
      where u.id = resident_app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "work_orders_update_manager_property"
  on public.work_orders for update to authenticated using (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.properties p
      join public.app_users u on u.id = p.managed_by_app_user_id
      where p.id = property_id and u.auth_user_id = auth.uid()
    )
  );

create policy "work_orders_update_admin"
  on public.work_orders for update to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

-- ── portal_thread_participants (who may read a thread) ───────────────────────
create table if not exists public.portal_thread_participants (
  thread_key text not null,
  app_user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_key, app_user_id)
);

create index if not exists portal_thread_participants_app_user_idx
  on public.portal_thread_participants (app_user_id);

comment on table public.portal_thread_participants is
  'Thread ACL; backend adds rows when a conversation is created. Required for portal_messages RLS.';

alter table public.portal_thread_participants enable row level security;

create policy "portal_thread_participants_select_self"
  on public.portal_thread_participants for select to authenticated using (
    exists (
      select 1 from public.app_users u
      where u.id = app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "portal_thread_participants_insert_self"
  on public.portal_thread_participants for insert to authenticated with check (
    exists (
      select 1 from public.app_users u
      where u.id = app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "portal_thread_participants_select_admin"
  on public.portal_thread_participants for select to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

-- ── portal_messages (threaded inbox; thread_key is stable string) ────────────
create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  thread_key text not null,
  channel text not null default 'resident_mgmt',
  author_app_user_id uuid references public.app_users (id) on delete set null,
  subject text,
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists portal_messages_thread_key_idx on public.portal_messages (thread_key);
create index if not exists portal_messages_created_at_idx on public.portal_messages (created_at desc);

comment on table public.portal_messages is 'Resident/manager/admin threaded messages; replaces Airtable Messages.';

alter table public.portal_messages enable row level security;

create policy "portal_messages_select_participant"
  on public.portal_messages for select to authenticated using (
    exists (
      select 1 from public.portal_thread_participants p
      join public.app_users u on u.id = p.app_user_id
      where p.thread_key = portal_messages.thread_key
        and u.auth_user_id = auth.uid()
    )
  );

create policy "portal_messages_select_author"
  on public.portal_messages for select to authenticated using (
    author_app_user_id is not null
    and exists (
      select 1 from public.app_users u
      where u.id = author_app_user_id and u.auth_user_id = auth.uid()
    )
  );

create policy "portal_messages_select_admin"
  on public.portal_messages for select to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "portal_messages_insert_self_author"
  on public.portal_messages for insert to authenticated with check (
    author_app_user_id is not null
    and exists (
      select 1 from public.app_users u
      where u.id = author_app_user_id and u.auth_user_id = auth.uid()
    )
  );

-- ── announcements ───────────────────────────────────────────────────────────
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  audience text not null default 'all_residents',
  status text not null default 'draft',
  priority integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_status_check check (
    status = any (array['draft'::text, 'published'::text, 'archived'::text])
  )
);

create index if not exists announcements_status_idx on public.announcements (status);
create index if not exists announcements_audience_idx on public.announcements (audience);

comment on table public.announcements is 'Building-wide or targeted announcements; audience is a logical key (e.g. all_residents, property:<uuid>).';

create or replace function public._announcements_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at before update on public.announcements
  for each row execute procedure public._announcements_set_updated_at();

alter table public.announcements enable row level security;

-- Any signed-in user may read published announcements in the active window.
create policy "announcements_select_published"
  on public.announcements for select to authenticated using (
    status = 'published'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

create policy "announcements_select_admin_all"
  on public.announcements for select to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "announcements_insert_admin"
  on public.announcements for insert to authenticated with check (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "announcements_update_admin"
  on public.announcements for update to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

create policy "announcements_delete_admin"
  on public.announcements for delete to authenticated using (
    exists (
      select 1 from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid() and r.role = 'admin'
    )
  );

commit;
