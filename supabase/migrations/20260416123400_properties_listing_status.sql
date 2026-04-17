-- Listing workflow for Postgres-backed properties (replaces Airtable approval columns for this path).
-- Public marketing uses: active = true AND listing_status = 'live'.

begin;

alter table public.properties
  add column if not exists listing_status text;

alter table public.properties
  add column if not exists admin_internal_notes text;

alter table public.properties
  add column if not exists edit_request_notes text;

update public.properties
set listing_status = case
  when coalesce(active, false) is true then 'live'::text
  else 'pending_review'::text
end
where listing_status is null;

alter table public.properties
  alter column listing_status set default 'pending_review';

alter table public.properties
  alter column listing_status set not null;

alter table public.properties
  drop constraint if exists properties_listing_status_check;

alter table public.properties
  add constraint properties_listing_status_check check (
    listing_status = any (
      array[
        'pending_review'::text,
        'changes_requested'::text,
        'live'::text,
        'unlisted'::text,
        'rejected'::text
      ]
    )
  );

comment on column public.properties.listing_status is
  'Workflow: pending_review | changes_requested | live (public when active) | unlisted | rejected.';

comment on column public.properties.admin_internal_notes is
  'Admin-only notes (not shown on marketing site).';

comment on column public.properties.edit_request_notes is
  'Visible to manager when admin requests listing changes.';

commit;
