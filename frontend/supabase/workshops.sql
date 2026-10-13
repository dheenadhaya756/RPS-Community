-- ============================================================================
-- Workshops — the sessions an admin adds from /admin/workshops
-- Run AFTER schema.sql and hosts.sql, in the Supabase SQL editor.
-- Then run testimonials.sql. Safe to re-run.
-- This file does not insert the current workshops.
-- Those stay in lib/community/content.js until the save action is wired.
--
-- Pictures and the PDF are paths only, never the file itself.
-- A path looks like /assets/workshops/shortlist-ready-portfolio.png
-- or /assets/resources/rps-cohort-02-workshop-notes.pdf.
-- ============================================================================

create table if not exists public.workshops (
  id                 uuid primary key default gen_random_uuid(),

  -- draft stays off the public list. active is what visitors can see.
  status             text not null default 'draft',
  cohort_label       text,
  slug               text not null,          -- page address, /workshops/[slug]
  title              text not null,
  summary            text,
  pitch              text,

  description        text[] not null default '{}',   -- full description, one item per paragraph
  who_its_for        text[] not null default '{}',
  curriculum_title   text,                            -- "What's in it for you?"
  curriculum         text[] not null default '{}',

  date_time          timestamptz,                     -- India time is stored with its offset
  duration_mins      int not null,
  capacity           int not null default 45,         -- shown on the page. The form does not edit it.

  banner_url         text,                            -- workshop picture, path only
  email_banner_url   text,                            -- small email picture, path only

  meet_link          text,
  dial_number        text,                            -- optional phone dial-in
  dial_pin           text,                            -- optional

  recording_url      text,                            -- YouTube (or other) link, after the session

  notes_title        text,
  notes_description  text,
  notes_file_url     text,                            -- PDF path only
  notes_file_name    text,
  notes_pages        int,                             -- counted from the PDF on save
  notes_size_bytes   bigint,                          -- counted from the PDF on save

  recap              text[] not null default '{}',    -- what happened in the room

  created_at         timestamptz not null default now(),
  created_by         text,                            -- email of the admin who added it
  updated_at         timestamptz not null default now(),
  updated_by         text                             -- email of the admin who last edited it
);

comment on table public.workshops is
  'Workshops an admin adds. Picture and PDF columns store a path, not the file. A draft is not on the public list.';

comment on column public.workshops.notes_pages is
  'Page count of the notes PDF. The save action counts this. It is not typed in.';

comment on column public.workshops.notes_size_bytes is
  'Size of the notes PDF in bytes. The save action measures this. The public page turns it into a line such as 3.7 MB.';

comment on column public.workshops.created_by is
  'Email of the admin who added this workshop. Filled in by the save action, not by the database.';

comment on column public.workshops.updated_by is
  'Email of the admin who last edited this workshop. Filled in by the save action, not by the database.';

-- Hosts on a workshop, in the order the admin chose them.
create table if not exists public.workshop_hosts (
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  host_id      uuid not null references public.hosts (id) on delete cascade,
  position     int not null default 0,
  primary key (workshop_id, host_id)
);

comment on table public.workshop_hosts is
  'Which hosts run a workshop, in display order. position 0 is first.';

-- Title is the one field the form will not save without.
alter table public.workshops drop constraint if exists workshops_title_check;
alter table public.workshops
  add constraint workshops_title_check check (char_length(btrim(title)) >= 2);

alter table public.workshops drop constraint if exists workshops_slug_check;
alter table public.workshops
  add constraint workshops_slug_check check (char_length(btrim(slug)) >= 1);

alter table public.workshops drop constraint if exists workshops_status_check;
alter table public.workshops
  add constraint workshops_status_check check (status in ('draft', 'active'));

alter table public.workshops drop constraint if exists workshops_duration_check;
alter table public.workshops
  add constraint workshops_duration_check check (duration_mins > 0);

alter table public.workshops drop constraint if exists workshops_capacity_check;
alter table public.workshops
  add constraint workshops_capacity_check check (capacity > 0);

alter table public.workshops drop constraint if exists workshops_notes_pages_check;
alter table public.workshops
  add constraint workshops_notes_pages_check
  check (notes_pages is null or notes_pages >= 0);

alter table public.workshops drop constraint if exists workshops_notes_size_check;
alter table public.workshops
  add constraint workshops_notes_size_check
  check (notes_size_bytes is null or notes_size_bytes >= 0);

create unique index if not exists workshops_slug_idx on public.workshops (slug);
create index if not exists workshops_status_idx on public.workshops (status);
create index if not exists workshops_date_time_idx on public.workshops (date_time);
create unique index if not exists workshop_hosts_order_idx
  on public.workshop_hosts (workshop_id, position);

-- updated_at moves on its own. created_by and updated_by wait for the action.
drop trigger if exists workshops_touch on public.workshops;
create trigger workshops_touch before update on public.workshops
  for each row execute function public.touch_updated_at();

-- Closed until the save action exists. The service-role key used by the
-- server bypasses this, so an admin action can read and write. A normal
-- signed-in user and a guest cannot.
alter table public.workshops enable row level security;
alter table public.workshop_hosts enable row level security;
