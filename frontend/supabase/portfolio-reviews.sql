-- ============================================================================
-- Portfolio reviews — the links people send from /review
-- Run in the Supabase SQL editor, after schema.sql. Safe to re-run.
--
-- One row per account per link. The report itself comes later: every row
-- starts QUEUED, and whatever generates the reports picks them up from here.
-- Sending the same link again doesn't add a row; it bumps the existing one
-- back to the top of the queue.
--
-- Until this runs, the box on /review tells people it isn't open yet and saves
-- nothing.
-- ============================================================================

create table if not exists public.portfolio_reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- Stamped from the verified session by the trigger below, never taken from
  -- the browser, so a row can't be filed under someone else's address.
  email         text,
  name          text,

  portfolio_url text not null,
  status        text not null default 'QUEUED',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, portfolio_url)
);

comment on table public.portfolio_reviews is
  'Portfolio links sent from /review, waiting on (or holding) their report.';

alter table public.portfolio_reviews drop constraint if exists portfolio_reviews_url_check;
alter table public.portfolio_reviews
  add constraint portfolio_reviews_url_check
  check (portfolio_url ~* '^https?://' and length(portfolio_url) <= 2048);

alter table public.portfolio_reviews drop constraint if exists portfolio_reviews_status_check;
alter table public.portfolio_reviews
  add constraint portfolio_reviews_status_check
  check (status in ('QUEUED', 'DONE', 'FAILED'));

-- ---------------------------------------------------------------------------
-- Who the row belongs to comes from the session, whatever the request says.
-- A person can't mark their own review DONE either: status is reset to
-- QUEUED on every write that comes through a normal session.
-- ---------------------------------------------------------------------------
create or replace function public.portfolio_reviews_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (the report worker, the dashboard) writes as itself.
  if auth.uid() is null then
    return new;
  end if;
  new.user_id    := auth.uid();
  new.email      := coalesce(auth.jwt() ->> 'email', new.email);
  new.status     := 'QUEUED';
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists portfolio_reviews_stamp on public.portfolio_reviews;
create trigger portfolio_reviews_stamp
  before insert or update on public.portfolio_reviews
  for each row execute function public.portfolio_reviews_stamp();

-- ---------------------------------------------------------------------------
-- RLS: a person sees and resends their own links and nothing else.
-- ---------------------------------------------------------------------------
alter table public.portfolio_reviews enable row level security;

drop policy if exists "portfolio_reviews: read own" on public.portfolio_reviews;
create policy "portfolio_reviews: read own"
  on public.portfolio_reviews for select
  using (user_id = auth.uid());

drop policy if exists "portfolio_reviews: insert own" on public.portfolio_reviews;
create policy "portfolio_reviews: insert own"
  on public.portfolio_reviews for insert
  with check (user_id = auth.uid());

drop policy if exists "portfolio_reviews: update own" on public.portfolio_reviews;
create policy "portfolio_reviews: update own"
  on public.portfolio_reviews for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists portfolio_reviews_queue_idx
  on public.portfolio_reviews (status, updated_at);

-- Sanity check.
select status, count(*) from public.portfolio_reviews group by status;
