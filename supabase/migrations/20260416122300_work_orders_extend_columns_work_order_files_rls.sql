-- Work orders: extra columns for portal/manager parity + RLS on work_order_files (UUID work_order_id as text).

begin;

alter table public.work_orders
  add column if not exists title text not null default '';

alter table public.work_orders
  add column if not exists manager_cost_usd numeric;

alter table public.work_orders
  add column if not exists legacy_airtable_resident_profile_id text;

alter table public.work_orders
  add column if not exists legacy_airtable_application_id text;

alter table public.work_orders
  add column if not exists update_log text not null default '';

alter table public.work_orders
  add column if not exists resident_display_email text;

comment on column public.work_orders.title is 'Short request title (manager + resident UI).';
comment on column public.work_orders.manager_cost_usd is 'Optional manager-entered billable amount (USD).';
comment on column public.work_orders.legacy_airtable_resident_profile_id is 'Optional Airtable Resident Profile rec… for billing/manager scope until residents migrate.';
comment on column public.work_orders.legacy_airtable_application_id is 'Optional Airtable Applications rec… for filters until applications migrate.';
comment on column public.work_orders.update_log is 'Resident-visible append-only notes (replaces Airtable Update field).';

comment on column public.work_orders.resident_display_email is
  'Submitter email snapshot for manager UI (avoids broad app_users SELECT policies).';

-- Residents need to read their property row when resolving legacy_airtable_record_id / name for work_orders inserts.
create policy "properties_select_for_own_applications"
  on public.properties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.app_users u on u.id = a.applicant_app_user_id
      where a.property_id = properties.id
        and u.auth_user_id = auth.uid()
    )
  );

-- ── work_order_files RLS (work_order_id stored as text: UUID string) ───────

create policy "work_order_files_select_own_resident_wo"
  on public.work_order_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.work_orders wo
      join public.app_users u on u.id = wo.resident_app_user_id
      where wo.id::text = work_order_files.work_order_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "work_order_files_select_manager_property_wo"
  on public.work_order_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.work_orders wo
      join public.properties p on p.id = wo.property_id
      join public.app_users u on u.id = p.managed_by_app_user_id
      where wo.id::text = work_order_files.work_order_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "work_order_files_select_admin"
  on public.work_order_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid()
        and r.role = 'admin'
    )
  );

create policy "work_order_files_insert_own_resident_wo"
  on public.work_order_files
  for insert
  to authenticated
  with check (
    uploaded_by_app_user_id is not null
    and exists (
      select 1
      from public.app_users uu
      where uu.id = uploaded_by_app_user_id
        and uu.auth_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.work_orders wo
      join public.app_users u on u.id = wo.resident_app_user_id
      where wo.id::text = work_order_files.work_order_id
        and u.auth_user_id = auth.uid()
    )
  );

create policy "work_order_files_delete_own_resident_wo"
  on public.work_order_files
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.work_orders wo
      join public.app_users u on u.id = wo.resident_app_user_id
      where wo.id::text = work_order_files.work_order_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;
