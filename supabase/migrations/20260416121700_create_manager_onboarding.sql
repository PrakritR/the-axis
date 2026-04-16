begin;

create table if not exists public.manager_onboarding (
  id uuid primary key default gen_random_uuid(),
  manager_id text not null unique,
  email text not null unique,
  full_name text,
  phone_number text,
  plan_type text not null default 'free',
  billing_interval text not null default 'free',
  onboarding_source text,
  stripe_checkout_session_id text,
  account_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_onboarding_plan_type_check
    check (plan_type = any (array['free'::text, 'pro'::text, 'business'::text])),
  constraint manager_onboarding_billing_interval_check
    check (billing_interval = any (array['free'::text, 'waived'::text, 'monthly'::text, 'annual'::text])),
  constraint manager_onboarding_email_lower_check
    check (email = lower(email))
);

create index if not exists manager_onboarding_manager_id_idx on public.manager_onboarding (manager_id);
create index if not exists manager_onboarding_email_idx on public.manager_onboarding (email);

comment on table public.manager_onboarding is
  'Pre-auth manager onboarding records used for pricing, checkout completion, and portal account bootstrap.';

create or replace function public._manager_onboarding_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists manager_onboarding_set_updated_at on public.manager_onboarding;
create trigger manager_onboarding_set_updated_at
  before update on public.manager_onboarding
  for each row
  execute procedure public._manager_onboarding_set_updated_at();

alter table public.manager_onboarding enable row level security;

commit;
