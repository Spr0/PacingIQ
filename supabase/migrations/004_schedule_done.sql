-- ---------------------------------------------------------------------------
-- Migration 004: let a scheduled visit be marked done by hand.
--
-- Run this ONCE in the Supabase SQL Editor, after 003. Re-runnable.
--
-- A visit normally counts as done because an observation exists for that
-- teacher on that date -- derived, so logging an observation ticks the box
-- with no extra step. But a coach who walks a classroom and can't stop to
-- write it up still needs to record that she was there, so done_at is the
-- manual override. Both are shown the same way on the Schedule page and the
-- dashboard; done_at just means "no observation was written for it".
--
-- Nullable rather than a boolean so the timestamp itself is the record, and
-- clearing it (un-ticking) is a plain set-to-null.
-- ---------------------------------------------------------------------------

alter table public.schedule_entries
  add column if not exists done_at timestamptz,
  add column if not exists done_by text;

-- Any assigned role may tick a visit off -- principals, APs, and ABSS do
-- walkthroughs too, and the rotation belongs to the school rather than to
-- whoever pressed Randomize. Policies for schedule_entries were already set
-- to can_write() in migration 002, so there is nothing further to change
-- here; this comment exists so that isn't mistaken for an oversight.

select count(*) as schedule_entries, count(done_at) as marked_done
from public.schedule_entries;
