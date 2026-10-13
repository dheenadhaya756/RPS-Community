-- ============================================================================
-- Testimonials — quotes from people who were in a workshop
-- Run AFTER schema.sql, hosts.sql, and workshops.sql, in the Supabase SQL
-- editor. Safe to re-run. This file does not insert the current quotes.
-- Those stay in lib/community/content.js until the save action is wired.
-- ============================================================================

create table if not exists public.workshop_testimonials (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  position     int not null default 0,
  name         text,
  role         text,
  quote        text,
  featured     boolean not null default false,

  created_at   timestamptz not null default now(),
  created_by   text,                 -- email of the admin who added this quote
  updated_at   timestamptz not null default now(),
  updated_by   text                  -- email of the admin who last edited it
);

comment on table public.workshop_testimonials is
  'Quotes for one workshop. Featured quotes lead the page and the homepage uses them for the latest session.';

comment on column public.workshop_testimonials.created_by is
  'Email of the admin who added this quote. Filled in by the save action, not by the database.';

comment on column public.workshop_testimonials.updated_by is
  'Email of the admin who last edited this quote. Filled in by the save action, not by the database.';

-- One slot per workshop. position 0 is the first quote on the form.
create unique index if not exists workshop_testimonials_order_idx
  on public.workshop_testimonials (workshop_id, position);

-- updated_at moves on its own. created_by and updated_by wait for the action.
drop trigger if exists workshop_testimonials_touch on public.workshop_testimonials;
create trigger workshop_testimonials_touch before update on public.workshop_testimonials
  for each row execute function public.touch_updated_at();

-- Closed until the save action exists. The service-role key used by the
-- server bypasses this, so an admin action can read and write. A normal
-- signed-in user and a guest cannot.
alter table public.workshop_testimonials enable row level security;
