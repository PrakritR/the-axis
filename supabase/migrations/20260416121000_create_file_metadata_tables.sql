-- Internal file metadata for Supabase Storage (blobs live in Storage only).
-- Access: backend API uses service role; RLS enabled without policies = no direct PostgREST access for anon/auth.

begin;

-- ── lease_files (private bucket: leases) ───────────────────────────────────
-- Paths use application_id scope until a dedicated internal leases table exists.

create table if not exists public.lease_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  lease_id uuid,
  storage_bucket text not null default 'leases',
  storage_path text not null,
  file_kind text not null default 'attachment',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_files_bucket_check check (storage_bucket = 'leases'),
  constraint lease_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint lease_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists lease_files_application_id_idx on public.lease_files (application_id);

-- ── application_files (private bucket: application documents) ─────────────

create table if not exists public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  storage_bucket text not null default 'application documents',
  storage_path text not null,
  document_kind text not null default 'other',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_files_bucket_check check (storage_bucket = 'application documents'),
  constraint application_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint application_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists application_files_application_id_idx on public.application_files (application_id);

-- ── property_images (public buckets: property-images | bathroom-images | shared-space-image) ──

create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  bathroom_id uuid,
  shared_space_id uuid,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  alt_text text,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_images_bucket_check check (
    storage_bucket = any (
      array['property-images'::text, 'bathroom-images'::text, 'shared-space-image'::text]
    )
  ),
  constraint property_images_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint property_images_context_check check (
    (storage_bucket = 'property-images' and bathroom_id is null and shared_space_id is null)
    or (storage_bucket = 'bathroom-images' and bathroom_id is not null and shared_space_id is null)
    or (storage_bucket = 'shared-space-image' and shared_space_id is not null and bathroom_id is null)
  ),
  constraint property_images_unique_path unique (storage_bucket, storage_path)
);

create index if not exists property_images_property_id_idx on public.property_images (property_id);

-- ── room_images (public bucket: room-image) ──────────────────────────────

create table if not exists public.room_images (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  storage_bucket text not null default 'room-image',
  storage_path text not null,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  alt_text text,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_images_bucket_check check (storage_bucket = 'room-image'),
  constraint room_images_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint room_images_unique_path unique (storage_bucket, storage_path)
);

create index if not exists room_images_room_id_idx on public.room_images (room_id);

-- ── work_order_files (private bucket: work-order-images) ───────────────────
-- work_order_id is not FK yet (internal work_orders table pending).

create table if not exists public.work_order_files (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  storage_bucket text not null default 'work-order-images',
  storage_path text not null,
  file_kind text not null default 'image',
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by_app_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_files_bucket_check check (storage_bucket = 'work-order-images'),
  constraint work_order_files_path_nonempty check (char_length(trim(storage_path)) > 0),
  constraint work_order_files_unique_path unique (storage_bucket, storage_path)
);

create index if not exists work_order_files_work_order_id_idx on public.work_order_files (work_order_id);

-- updated_at triggers (same pattern as other internal tables)

create or replace function public._lease_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists lease_files_set_updated_at on public.lease_files;
create trigger lease_files_set_updated_at before update on public.lease_files
  for each row execute procedure public._lease_files_set_updated_at();

create or replace function public._application_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists application_files_set_updated_at on public.application_files;
create trigger application_files_set_updated_at before update on public.application_files
  for each row execute procedure public._application_files_set_updated_at();

create or replace function public._property_images_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists property_images_set_updated_at on public.property_images;
create trigger property_images_set_updated_at before update on public.property_images
  for each row execute procedure public._property_images_set_updated_at();

create or replace function public._room_images_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists room_images_set_updated_at on public.room_images;
create trigger room_images_set_updated_at before update on public.room_images
  for each row execute procedure public._room_images_set_updated_at();

create or replace function public._work_order_files_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists work_order_files_set_updated_at on public.work_order_files;
create trigger work_order_files_set_updated_at before update on public.work_order_files
  for each row execute procedure public._work_order_files_set_updated_at();

alter table public.lease_files enable row level security;
alter table public.application_files enable row level security;
alter table public.property_images enable row level security;
alter table public.room_images enable row level security;
alter table public.work_order_files enable row level security;

comment on table public.lease_files is 'Supabase Storage metadata — bucket leases (private).';
comment on table public.application_files is 'Supabase Storage metadata — bucket application documents (private).';
comment on table public.property_images is 'Listing images — buckets property-images | bathroom-images | shared-space-image (public).';
comment on table public.room_images is 'Room listing images — bucket room-image (public).';
comment on table public.work_order_files is 'Work order uploads — bucket work-order-images (private). work_order_id FK pending.';

commit;
