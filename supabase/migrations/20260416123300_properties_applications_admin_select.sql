-- Allow admins to read properties and applications so PostgREST can embed
-- related rows when selecting lease_drafts (manager policies already exist).

begin;

create policy "properties_select_admin"
  on public.properties
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

create policy "applications_select_admin"
  on public.applications
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

commit;
