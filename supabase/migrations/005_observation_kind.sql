-- ---------------------------------------------------------------------------
-- Migration 005: tell a classroom observation apart from a coaching note.
--
-- Run this ONCE in the Supabase SQL Editor, after 004. Re-runnable.
--
-- WHY
--   A coaching note and a classroom observation were the same row, with
--   nothing to distinguish them. So typing a note at your desk set the
--   teacher's "last seen" date, satisfied the 14-day compliance window,
--   lowered their risk score, and -- worst -- ticked a scheduled classroom
--   visit off as observed, because isEntryDone() matches any observation on
--   the scheduled date. The app exists to track whether teachers are actually
--   being seen, and this quietly reported visits that never happened.
--
--   Measured before this ran: 4 of 8 observation rows were desk notes, three
--   of them dated the same day and already counting toward compliance for
--   three teachers.
--
-- BACKFILL
--   The observation form always defaults engagement_level to 'Medium' and the
--   quick-add note never sets it, so its absence identifies notes reliably on
--   this data. lesson_observed and evidence are checked too, so a real
--   observation saved without an engagement level is not mislabelled.
--
--   NOT NULL with no default on purpose: an insert that forgets to say which
--   kind it is should fail loudly here rather than silently land in whichever
--   bucket happened to be the default and skew the numbers again.
-- ---------------------------------------------------------------------------

alter table public.observations
  add column if not exists kind text;

-- Classify what already exists.
update public.observations
set kind = case
  when coalesce(engagement_level, '') = ''
   and coalesce(lesson_observed, '') = ''
   and coalesce(evidence, '') = ''
  then 'note'
  else 'observation'
end
where kind is null;

alter table public.observations
  alter column kind set not null;

alter table public.observations drop constraint if exists observations_kind_check;
alter table public.observations add constraint observations_kind_check
  check (kind in ('observation', 'note'));

-- ---------------------------------------------------------------------------
-- Verify: expect a split, not everything in one bucket. The 'note' rows are
-- the ones that will stop counting as classroom visits.
-- ---------------------------------------------------------------------------
select kind, count(*) as rows, min(date) as earliest, max(date) as latest
from public.observations
group by kind
order by kind;
