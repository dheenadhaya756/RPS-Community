-- ============================================================================
-- Hosts — the people who run a workshop
-- Run AFTER schema.sql, in the Supabase SQL editor. Safe to re-run.
--
-- This is the list behind /admin/hosts. The public pages still read
-- lib/community/content.js until the save actions are wired.
--
-- Pictures are paths only, never the file itself. A path looks like
-- /uploads/mentors/1791784692588-ku12n2.jpg. The save action writes the file
-- outside public/, under UPLOAD_DIR (frontend/uploads on this machine).
-- ============================================================================

create table if not exists public.hosts (
  id            uuid primary key default gen_random_uuid(),

  name          text not null,
  title         text,                 -- job title, the long line
  bio           text,                 -- short bio
  role          text,                 -- short label under the portrait
  years         int,

  -- Paths only. The file lives on disk, under public/assets/mentors.
  photo_url     text,                 -- small photo, the face used in lists
  portrait_url  text,                 -- larger portrait, the workshop page

  created_at    timestamptz not null default now(),
  created_by    text,                 -- email of the admin who added this host
  updated_at    timestamptz not null default now(),
  updated_by    text                  -- email of the admin who last edited it
);

comment on table public.hosts is
  'Workshop hosts. Photo columns store a path, not the image file.';

comment on column public.hosts.photo_url is
  'Path of the small photo, such as /assets/mentors/vineet-avatar.jpg. The file is not stored in the database.';

comment on column public.hosts.portrait_url is
  'Path of the larger portrait, such as /assets/mentors/vineet.jpg. The file is not stored in the database.';

comment on column public.hosts.created_by is
  'Email of the admin who added this host. Filled in by the save action, not by the database.';

comment on column public.hosts.updated_by is
  'Email of the admin who last edited this host. Filled in by the save action, not by the database.';

-- Name is the one field the form will not save without.
alter table public.hosts drop constraint if exists hosts_name_check;
alter table public.hosts
  add constraint hosts_name_check check (char_length(btrim(name)) >= 2);

-- Matches the form: years is empty, or a number up to 99.
alter table public.hosts drop constraint if exists hosts_years_check;
alter table public.hosts
  add constraint hosts_years_check
  check (years is null or (years >= 0 and years <= 99));

-- updated_at moves on its own. created_by and updated_by wait for the action.
drop trigger if exists hosts_touch on public.hosts;
create trigger hosts_touch before update on public.hosts
  for each row execute function public.touch_updated_at();

create index if not exists hosts_created_at_idx on public.hosts (created_at desc);

-- Closed until the save action exists. The service-role key used by the
-- server bypasses this, so an admin action can read and write. A normal
-- signed-in user and a guest cannot.
alter table public.hosts enable row level security;
