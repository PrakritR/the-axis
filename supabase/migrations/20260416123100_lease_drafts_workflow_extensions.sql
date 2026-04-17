-- Lease drafts: widen status for Airtable-compatible workflow labels + thread/PDF columns.

begin;

alter table public.lease_drafts drop constraint if exists lease_drafts_status_check;

alter table public.lease_drafts
  add column if not exists manager_edit_notes text,
  add column if not exists admin_response_notes text,
  add column if not exists current_version integer not null default 1,
  add column if not exists current_pdf_url text,
  add column if not exists current_pdf_file_name text,
  add column if not exists lease_comments jsonb not null default '[]'::jsonb;

comment on column public.lease_drafts.status is
  'Workflow label (Airtable-compatible), e.g. Draft Generated, Submitted to Admin, Published.';
comment on column public.lease_drafts.lease_comments is
  'JSON array of thread messages: Author Name, Author Role, Author Record ID, Message, Timestamp, Resolved.';

commit;
