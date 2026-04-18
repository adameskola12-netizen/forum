-- ============================================================================
-- Forum House Ledger — Phase B schema
-- Run in Supabase SQL Editor. Creates tables, RLS policies, and triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

-- is_owner(): check whether the calling user has role='owner'.
-- plpgsql (not sql) so reference to public.profiles is resolved at call time,
-- allowing this function to be defined before the table exists.
-- security definer avoids RLS recursion when policies reference profiles.
create or replace function public.is_owner()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
end;
$$;

-- set_updated_at(): generic trigger to stamp updated_at on row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'member' check (role in ('member','owner')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Self can update own profile; owners can update any profile.
-- Role column changes are further restricted by the trigger below.
create policy "profiles_update_self_or_owner"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

create policy "profiles_delete_owners"
  on public.profiles for delete
  to authenticated
  using (public.is_owner());

-- Trigger: block non-owners from changing the role column.
create or replace function public.protect_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only owners can change profile role';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role_change
  before update on public.profiles
  for each row execute function public.protect_profile_role_change();

-- Auto-create a profile row when a new auth.users row is inserted.
-- The first-ever profile becomes 'owner'; all subsequent profiles default to 'member'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text;
begin
  if not exists (select 1 from public.profiles) then
    assigned_role := 'owner';
  else
    assigned_role := 'member';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, assigned_role);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- transactions
-- ----------------------------------------------------------------------------
create table public.transactions (
  id                 text primary key,                           -- PodPlay transaction ID
  date_utc           timestamptz not null,
  source             text,
  event_type         text,
  description        text,
  email              text,
  customer_name      text,
  membership         text,
  area               text,
  subtotal           numeric,
  discounts          numeric,
  gross              numeric,
  payment_fee        numeric,
  net_revenue        numeric,
  payment_method     text,
  reporting_category text,
  raw_row            jsonb,                                      -- full original CSV row
  uploaded_by        uuid not null references auth.users(id),
  uploaded_at        timestamptz not null default now()
);

create index transactions_date_utc_idx on public.transactions(date_utc);
create index transactions_source_idx   on public.transactions(source);
create index transactions_area_idx     on public.transactions(area);
create index transactions_email_idx    on public.transactions(email);

alter table public.transactions enable row level security;

create policy "transactions_select_authenticated"
  on public.transactions for select
  to authenticated
  using (true);

create policy "transactions_insert_authenticated"
  on public.transactions for insert
  to authenticated
  with check (uploaded_by = auth.uid());

create policy "transactions_delete_owners"
  on public.transactions for delete
  to authenticated
  using (public.is_owner());

-- ----------------------------------------------------------------------------
-- goals
-- ----------------------------------------------------------------------------
create table public.goals (
  id          uuid primary key default gen_random_uuid(),
  period      text not null check (period in ('day','week','month','quarter','year')),
  period_key  text not null,                                     -- yyyy-mm-dd
  metric      text not null check (metric in ('net_revenue','transactions','unique_customers')),
  value       numeric not null,
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (period, period_key, metric)
);

alter table public.goals enable row level security;

create policy "goals_select_authenticated"
  on public.goals for select
  to authenticated
  using (true);

create policy "goals_insert_authenticated"
  on public.goals for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "goals_update_authenticated"
  on public.goals for update
  to authenticated
  using (true)
  with check (true);

create policy "goals_delete_owners"
  on public.goals for delete
  to authenticated
  using (public.is_owner());

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- uploads (audit log)
-- ----------------------------------------------------------------------------
create table public.uploads (
  id                          uuid primary key default gen_random_uuid(),
  uploaded_by                 uuid not null references auth.users(id),
  uploaded_at                 timestamptz not null default now(),
  file_name                   text,
  rows_added                  integer,
  rows_skipped                integer,
  rows_failed                 integer,
  earliest_transaction_date   timestamptz,
  latest_transaction_date     timestamptz
);

alter table public.uploads enable row level security;

create policy "uploads_select_authenticated"
  on public.uploads for select
  to authenticated
  using (true);

create policy "uploads_insert_self"
  on public.uploads for insert
  to authenticated
  with check (uploaded_by = auth.uid());

-- No update or delete policies on uploads = audit log is append-only.

-- ----------------------------------------------------------------------------
-- Backfill: create profiles for any auth.users that existed before this schema ran.
-- Orders by created_at so the earliest-invited user becomes 'owner'.
-- Safe to re-run (on conflict do nothing).
-- ----------------------------------------------------------------------------
with ranked as (
  select
    u.id,
    u.email,
    case when row_number() over (order by u.created_at) = 1 then 'owner' else 'member' end as role
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
)
insert into public.profiles (id, email, role)
select id, email, role from ranked
on conflict (id) do nothing;
