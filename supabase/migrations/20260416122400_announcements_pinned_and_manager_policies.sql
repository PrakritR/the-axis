-- Announcements: pin flag (Airtable parity) + manager draft insert + read/update own drafts.

begin;

alter table public.announcements
  add column if not exists pinned boolean not null default false;

comment on column public.announcements.pinned is 'When true, announcement sorts ahead of unpinned rows in portals.';

-- Managers may create draft announcements (submitted for admin review).
create policy "announcements_insert_manager_draft"
  on public.announcements
  for insert
  to authenticated
  with check (
    status = 'draft'::text
    and exists (
      select 1
      from public.app_user_roles r
      join public.app_users u on u.id = r.app_user_id
      where u.auth_user_id = auth.uid()
        and r.role = 'manager'::text
    )
  );

-- Authors can read their own drafts (in addition to admin select-all + published select).
create policy "announcements_select_own_draft"
  on public.announcements
  for select
  to authenticated
  using (
    status = 'draft'::text
    and created_by_app_user_id is not null
    and exists (
      select 1
      from public.app_users u
      where u.id = created_by_app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

-- Authors with manager role may update their own drafts only (stay draft or same fields).
create policy "announcements_update_manager_own_draft"
  on public.announcements
  for update
  to authenticated
  using (
    status = 'draft'::text
    and created_by_app_user_id is not null
    and exists (
      select 1
      from public.app_users u
      where u.id = created_by_app_user_id
        and u.auth_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.app_user_roles r
      join public.app_users u2 on u2.id = r.app_user_id
      where u2.auth_user_id = auth.uid()
        and r.role = 'manager'::text
    )
  )
  with check (status = 'draft'::text);

commit;
