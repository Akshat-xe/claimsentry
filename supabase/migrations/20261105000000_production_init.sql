-- CLAIM-SENTRY: PRODUCTION SUPABASE SCHEMA (Hactoberfest Org)
-- Enforces Row Level Security (RLS) and strict multi-tenancy.
-- Zero API Key Storage: User secrets are never persisted in these tables.

-- 1. User Profiles linked to Supabase Auth
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- 2. Triage Runs
create table if not exists public.triage_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete set null,
  repo_url text not null,
  repo_name text not null,
  total_claims integer default 0,
  verified_count integer default 0,
  fake_count integer default 0,
  untested_count integer default 0,
  duration_ms double precision default 0.0,
  created_at timestamptz default now()
);

alter table public.triage_runs enable row level security;

create policy "Users can view own triage runs"
  on public.triage_runs for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can insert own triage runs"
  on public.triage_runs for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- 3. Triage Claims & Evidence Dossiers
create table if not exists public.triage_claims (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references public.triage_runs(id) on delete cascade not null,
  issue_number integer not null,
  issue_title text not null,
  issue_type text not null,
  is_real_issue boolean,
  verdict_badge text,
  verdict_headline text,
  what_user_wrote text,
  how_we_tested text,
  our_verdict_explanation text,
  evidence jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.triage_claims enable row level security;

create policy "Users can view claims of own runs"
  on public.triage_claims for select
  to authenticated
  using (
    exists (
      select 1 from public.triage_runs
      where public.triage_runs.id = public.triage_claims.run_id
      and public.triage_runs.user_id = (select auth.uid())
    )
  );

create policy "Users can insert claims for own runs"
  on public.triage_claims for insert
  to authenticated
  with check (
    exists (
      select 1 from public.triage_runs
      where public.triage_runs.id = public.triage_claims.run_id
      and public.triage_runs.user_id = (select auth.uid())
    )
  );
