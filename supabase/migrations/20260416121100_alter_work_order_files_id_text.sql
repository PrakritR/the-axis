-- Work order rows still live in Airtable (rec…); store that id in metadata until internal work_orders exists.

begin;

alter table public.work_order_files
  alter column work_order_id type text using work_order_id::text;

comment on column public.work_order_files.work_order_id is 'Airtable Work Orders record id (rec…) or future internal UUID.';

commit;
