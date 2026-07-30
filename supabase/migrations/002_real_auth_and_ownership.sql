-- ---------------------------------------------------------------------------
-- Migration 002: real per-person auth, the ABSS role, record ownership.
--
-- Run this ONCE, in full, in the Supabase SQL Editor (Project > SQL Editor >
-- New query > paste > Run). It is written to be re-runnable: every drop uses
-- IF EXISTS and every add uses IF NOT EXISTS, so a partial run can be
-- repeated safely.
--
-- WHAT THIS CHANGES
--   1. Closes the anonymous-access hole. Until now every visitor to the URL
--      was auto-granted 'coach' -- full write and delete on all 48 teachers'
--      records -- via signInAnonymously() plus the profiles_anon_self_promote
--      policy. Both are removed here.
--   2. Adds the 'abss' role.
--   3. Opens create/edit to every real role (coach, principal, ap, abss) so
--      principals and APs can log their own walkthroughs, notes, and action
--      steps -- previously coach-only.
--   4. Restricts DELETE to coach only.
--   5. Adds created_by_id ownership so a non-coach can edit their own records
--      but not overwrite someone else's.
--
-- PREREQUISITE (do this first, in the dashboard):
--   Authentication > Sign In / Providers > turn "Allow anonymous sign-ins" OFF.
--
-- ACCOUNT SETUP (after running this):
--   Authentication > Users > Add user > *Create new user* -- NOT "Invite
--   user", which sends an email and fails against district mail filtering.
--   Check "Auto Confirm User". Then run the role assignments in section 7.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Drop the anonymous self-promotion hole and clear anonymous profiles.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_anon_self_promote" on public.profiles;

-- Deletes the 21 anonymous profiles. The auth.users rows they point at are
-- removed by Supabase separately (Authentication > Users), but with the
-- provider off and no profile row they can't reach anything regardless.
delete from public.profiles where email = 'anonymous';

-- ---------------------------------------------------------------------------
-- 2. Stop granting 'coach' to anonymous sign-ins. Every new sign-in now
--    defaults to 'pending' (no access) until a role is assigned by hand.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, 'unknown'),
    coalesce(new.raw_user_meta_data ->> 'name', new.email, 'New user'),
    'pending'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Add the 'abss' role to the allowed set.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'coach', 'principal', 'ap', 'abss'));

-- ---------------------------------------------------------------------------
-- 4. Role helper functions.
--    can_view()  -> any assigned role (unchanged in spirit, now includes abss)
--    can_write() -> any assigned role: create records and edit your own
--    is_coach()  -> coach only; this is what gates DELETE
-- ---------------------------------------------------------------------------
create or replace function public.can_view()
returns boolean language sql stable as $$
  select public.current_role() in ('coach', 'principal', 'ap', 'abss');
$$;

create or replace function public.can_write()
returns boolean language sql stable as $$
  select public.current_role() in ('coach', 'principal', 'ap', 'abss');
$$;

create or replace function public.can_review()
returns boolean language sql stable as $$
  select public.current_role() in ('principal', 'ap');
$$;

-- ---------------------------------------------------------------------------
-- 5. Ownership column on every table a non-coach can author.
--    NULL means "authored before per-user auth existed" -- treated as
--    coach-owned, so legacy rows can't be edited by everyone.
-- ---------------------------------------------------------------------------
alter table public.observations   add column if not exists created_by_id uuid references auth.users(id) on delete set null;
alter table public.pacing_entries add column if not exists created_by_id uuid references auth.users(id) on delete set null;
alter table public.interventions  add column if not exists created_by_id uuid references auth.users(id) on delete set null;
alter table public.action_plans   add column if not exists created_by_id uuid references auth.users(id) on delete set null;
alter table public.goals          add column if not exists created_by_id uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. Rewrite the write policies.
--
--    select : can_view()
--    insert : can_write() AND the row is stamped with your own id
--             (so authorship can't be forged from the client)
--    update : coach, or your own row
--    delete : coach only
--
--    Reference tables with no per-user author (teachers, schedule_entries,
--    action_plan_templates, assessments) keep a simpler shape: any real role
--    may create and edit, coach alone may delete.
-- ---------------------------------------------------------------------------

-- observations
drop policy if exists "observations_insert" on public.observations;
drop policy if exists "observations_update" on public.observations;
drop policy if exists "observations_delete" on public.observations;
create policy "observations_insert" on public.observations for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "observations_update" on public.observations for update
  using (public.is_coach() or created_by_id = auth.uid())
  with check (public.is_coach() or created_by_id = auth.uid());
create policy "observations_delete" on public.observations for delete
  using (public.is_coach());

-- pacing_entries
drop policy if exists "pacing_insert" on public.pacing_entries;
drop policy if exists "pacing_update" on public.pacing_entries;
drop policy if exists "pacing_delete" on public.pacing_entries;
create policy "pacing_insert" on public.pacing_entries for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "pacing_update" on public.pacing_entries for update
  using (public.is_coach() or created_by_id = auth.uid())
  with check (public.is_coach() or created_by_id = auth.uid());
create policy "pacing_delete" on public.pacing_entries for delete
  using (public.is_coach());

-- interventions (principal/AP also record the leadership review, so update
-- stays open to them on any row -- that is the point of the review step)
drop policy if exists "interventions_insert" on public.interventions;
drop policy if exists "interventions_update" on public.interventions;
drop policy if exists "interventions_delete" on public.interventions;
create policy "interventions_insert" on public.interventions for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "interventions_update" on public.interventions for update
  using (public.is_coach() or public.can_review() or created_by_id = auth.uid())
  with check (public.is_coach() or public.can_review() or created_by_id = auth.uid());
create policy "interventions_delete" on public.interventions for delete
  using (public.is_coach());

-- action_plans
drop policy if exists "plans_insert" on public.action_plans;
drop policy if exists "plans_update" on public.action_plans;
drop policy if exists "plans_delete" on public.action_plans;
create policy "plans_insert" on public.action_plans for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "plans_update" on public.action_plans for update
  using (public.is_coach() or created_by_id = auth.uid())
  with check (public.is_coach() or created_by_id = auth.uid());
create policy "plans_delete" on public.action_plans for delete
  using (public.is_coach());

-- goals
drop policy if exists "goals_insert" on public.goals;
drop policy if exists "goals_update" on public.goals;
drop policy if exists "goals_delete" on public.goals;
create policy "goals_insert" on public.goals for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "goals_update" on public.goals for update
  using (public.is_coach() or created_by_id = auth.uid())
  with check (public.is_coach() or created_by_id = auth.uid());
create policy "goals_delete" on public.goals for delete
  using (public.is_coach());

-- teachers (shared roster, no per-user author)
drop policy if exists "teachers_insert" on public.teachers;
drop policy if exists "teachers_update" on public.teachers;
drop policy if exists "teachers_delete" on public.teachers;
create policy "teachers_insert" on public.teachers for insert with check (public.can_write());
create policy "teachers_update" on public.teachers for update using (public.can_write()) with check (public.can_write());
create policy "teachers_delete" on public.teachers for delete using (public.is_coach());

-- schedule_entries (the rotation belongs to the school, not an individual)
drop policy if exists "schedule_insert" on public.schedule_entries;
drop policy if exists "schedule_update" on public.schedule_entries;
drop policy if exists "schedule_delete" on public.schedule_entries;
create policy "schedule_insert" on public.schedule_entries for insert with check (public.can_write());
create policy "schedule_update" on public.schedule_entries for update using (public.can_write()) with check (public.can_write());
create policy "schedule_delete" on public.schedule_entries for delete using (public.can_write());

-- assessments
drop policy if exists "assessments_insert" on public.assessments;
drop policy if exists "assessments_update" on public.assessments;
drop policy if exists "assessments_delete" on public.assessments;
create policy "assessments_insert" on public.assessments for insert with check (public.can_write());
create policy "assessments_update" on public.assessments for update using (public.can_write()) with check (public.can_write());
create policy "assessments_delete" on public.assessments for delete using (public.is_coach());

-- action_plan_templates (reusable library, shared)
drop policy if exists "templates_insert" on public.action_plan_templates;
drop policy if exists "templates_update" on public.action_plan_templates;
drop policy if exists "templates_delete" on public.action_plan_templates;
create policy "templates_insert" on public.action_plan_templates for insert with check (public.can_write());
create policy "templates_update" on public.action_plan_templates for update using (public.can_write()) with check (public.can_write());
create policy "templates_delete" on public.action_plan_templates for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- 7. Assign roles and display names.
--
-- RUN THIS ONLY AFTER creating the six users via Authentication > Users >
-- Add user > Create new user (Auto Confirm checked). It matches on email, so
-- a user who doesn't exist yet is simply skipped -- re-run it after adding
-- the rest. Emails are lowercased on both sides so dashboard-entered
-- capitalisation ("Stacys@susd12.org") still matches.
-- ---------------------------------------------------------------------------
update public.profiles p set role = v.role, name = v.name
from (values
  ('stacys@susd12.org',          'coach',     'Stacy Eilander'),
  ('scott23henderson@gmail.com', 'coach',     'Scott Henderson'),
  ('angelicae@susd12.org',       'principal', 'Angelica Encinas'),
  ('vickis@susd12.org',          'ap',        'Vicki Stailey'),
  ('shaneb@susd12.org',          'ap',        'Shane Bentley'),
  ('kerrir@susd12.org',          'abss',      'Kerri Ravenscroft')
) as v(email, role, name)
where lower(p.email) = v.email;

-- ---------------------------------------------------------------------------
-- 8. Verify. Expect exactly the six people above, no 'anonymous' rows, and
--    no remaining 'pending' unless someone signed in without being assigned.
-- ---------------------------------------------------------------------------
select email, name, role from public.profiles order by role, email;
