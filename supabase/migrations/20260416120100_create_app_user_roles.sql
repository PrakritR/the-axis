-- Role assignments for internal app users (many roles per app_users row).

begin;

create table if not exists public.app_user_roles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null
    references public.app_users (id) on delete cascade,
  role text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint app_user_roles_role_check
    check (role = any (array['admin'::text, 'manager'::text, 'owner'::text, 'resident'::text])),
  constraint app_user_roles_user_role_uniq unique (app_user_id, role)
);

create index if not exists app_user_roles_app_user_id_idx on public.app_user_roles (app_user_id);
create index if not exists app_user_roles_role_idx on public.app_user_roles (role);

comment on table public.app_user_roles is 'One row per (app_user, role); is_primary enforces at most one primary per app_user via trigger.';

-- At most one primary role per app_user: before insert/update, clear other rows' is_primary.
create or replace function public._app_user_roles_clear_other_primary()
returns trigger
language plpgsql
as $$
begin
  if new.is_primary is true then
    update public.app_user_roles
    set is_primary = false
    where app_user_id = new.app_user_id
      and id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists app_user_roles_single_primary on public.app_user_roles;
create trigger app_user_roles_single_primary
  before insert or update on public.app_user_roles
  for each row
  execute procedure public._app_user_roles_clear_other_primary();

alter table public.app_user_roles enable row level security;

create policy "app_user_roles_select_own"
  on public.app_user_roles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users u
      where u.id = app_user_id
        and u.auth_user_id = auth.uid()
    )
  );

commit;
