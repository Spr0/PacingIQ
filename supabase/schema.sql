-- ---------------------------------------------------------------------------
-- PacingIQ Supabase schema.
--
-- One table per src/data/store.js collection, plus `profiles` mapping a
-- signed-in auth.users row to an app name/role. Nested arrays that were
-- embedded JS objects (action items, agreed actions, plan steps) stay as
-- jsonb columns rather than becoming their own tables, so intelligence.js
-- and the UI components keep working against the same shapes with minimal
-- rewiring.
--
-- Run this once, in full, in the Supabase SQL Editor (Project > SQL Editor >
-- New query > paste > Run) on a fresh project.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: every signed-in user gets a row here. New sign-ins default to
-- 'pending' (no real access) until a coach or admin promotes them to
-- coach/principal/ap by editing this table directly in the Supabase
-- dashboard's Table Editor -- no app UI for this yet, intentionally, so
-- role escalation can't happen through the app itself.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'pending' check (role in ('pending', 'coach', 'principal', 'ap')),
  created_at timestamptz not null default now()
);

-- Auto-create a pending profile row whenever someone signs in for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper functions used throughout the RLS policies below.
create or replace function public.current_role()
returns text
language sql stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_coach()
returns boolean language sql stable as $$ select public.current_role() = 'coach'; $$;

create or replace function public.can_view()
returns boolean language sql stable as $$ select public.current_role() in ('coach', 'principal', 'ap'); $$;

create or replace function public.can_review()
returns boolean language sql stable as $$ select public.current_role() in ('principal', 'ap'); $$;

alter table public.profiles enable row level security;
create policy "profiles_select_all" on public.profiles for select using (public.can_view());
-- No update/insert/delete policy for normal users: role changes happen only
-- via the Supabase dashboard (as the table owner, bypassing RLS).

-- ---------------------------------------------------------------------------
-- teachers
-- ---------------------------------------------------------------------------
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  subjects text[],
  grade_level text,
  assigned_admin text,
  created_at timestamptz not null default now()
);

alter table public.teachers enable row level security;
create policy "teachers_select" on public.teachers for select using (public.can_view());
create policy "teachers_insert" on public.teachers for insert with check (public.is_coach());
create policy "teachers_update" on public.teachers for update using (public.is_coach()) with check (public.is_coach());
create policy "teachers_delete" on public.teachers for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- pacing_entries
-- ---------------------------------------------------------------------------
create table public.pacing_entries (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  week_of date not null,
  subject text,
  current_unit text,
  current_lesson text,
  current_standard text,
  days_behind integer not null default 0,
  exception_reason text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

alter table public.pacing_entries enable row level security;
create policy "pacing_select" on public.pacing_entries for select using (public.can_view());
create policy "pacing_insert" on public.pacing_entries for insert with check (public.is_coach());
create policy "pacing_update" on public.pacing_entries for update using (public.is_coach()) with check (public.is_coach());
create policy "pacing_delete" on public.pacing_entries for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- observations
-- ---------------------------------------------------------------------------
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  date date not null,
  time text,
  lesson_observed text,
  standard text,
  evidence text,
  engagement_level text,
  evidence_of_learning text,
  teacher_actions text,
  student_actions text,
  strengths text,
  areas_for_growth text,
  feedback_provided text,
  follow_up_observation_date date,
  action_items jsonb not null default '[]',
  attachments jsonb not null default '[]',
  created_by text,
  shared_with_teacher jsonb not null default '{"whole": false, "sections": []}',
  created_at timestamptz not null default now()
);

alter table public.observations enable row level security;
create policy "observations_select" on public.observations for select using (public.can_view());
create policy "observations_insert" on public.observations for insert with check (public.is_coach());
create policy "observations_update" on public.observations for update using (public.is_coach()) with check (public.is_coach());
create policy "observations_delete" on public.observations for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- assessments (completed unit tests and upcoming ones with null scores)
-- ---------------------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  name text not null,
  date date not null,
  avg_score numeric,
  proficiency_pct numeric,
  created_at timestamptz not null default now()
);

alter table public.assessments enable row level security;
create policy "assessments_select" on public.assessments for select using (public.can_view());
create policy "assessments_insert" on public.assessments for insert with check (public.is_coach());
create policy "assessments_update" on public.assessments for update using (public.is_coach()) with check (public.is_coach());
create policy "assessments_delete" on public.assessments for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- interventions -- the one table principal/ap can also update, to record
-- the leadership review requirement. Insert/delete stay coach-only.
-- ---------------------------------------------------------------------------
create table public.interventions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  status text not null default 'Open',
  opened_date date not null default current_date,
  concern text,
  root_cause text,
  responsible_person text,
  due_date date,
  follow_up_date date,
  evidence_of_completion text default '',
  requirements jsonb not null default '{"caseCreated": false, "actionPlan": false, "coachingMeetingScheduled": false, "followUpObservation": false, "leadershipReview": false}',
  agreed_actions jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.interventions enable row level security;
create policy "interventions_select" on public.interventions for select using (public.can_view());
create policy "interventions_insert" on public.interventions for insert with check (public.is_coach());
create policy "interventions_update" on public.interventions for update using (public.is_coach() or public.can_review()) with check (public.is_coach() or public.can_review());
create policy "interventions_delete" on public.interventions for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- action_plan_templates -- reusable, not teacher-specific.
-- ---------------------------------------------------------------------------
create table public.action_plan_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text default '',
  description text default '',
  steps jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.action_plan_templates enable row level security;
create policy "templates_select" on public.action_plan_templates for select using (public.can_view());
create policy "templates_insert" on public.action_plan_templates for insert with check (public.is_coach());
create policy "templates_update" on public.action_plan_templates for update using (public.is_coach()) with check (public.is_coach());
create policy "templates_delete" on public.action_plan_templates for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- action_plans -- teacher-specific, optionally started from a template.
-- ---------------------------------------------------------------------------
create table public.action_plans (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  template_id uuid references public.action_plan_templates(id) on delete set null,
  source text not null default 'custom',
  steps jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.action_plans enable row level security;
create policy "plans_select" on public.action_plans for select using (public.can_view());
create policy "plans_insert" on public.action_plans for insert with check (public.is_coach());
create policy "plans_update" on public.action_plans for update using (public.is_coach()) with check (public.is_coach());
create policy "plans_delete" on public.action_plans for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  title text not null,
  notes text default '',
  category text default '',
  owner text,
  target_date date,
  status text not null default 'Open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goals enable row level security;
create policy "goals_select" on public.goals for select using (public.can_view());
create policy "goals_insert" on public.goals for insert with check (public.is_coach());
create policy "goals_update" on public.goals for update using (public.is_coach()) with check (public.is_coach());
create policy "goals_delete" on public.goals for delete using (public.is_coach());

-- ---------------------------------------------------------------------------
-- audit_log -- append-only from the app's perspective; every viewer can log
-- their own actions (login, edits), nobody edits or deletes past entries.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  "timestamp" timestamptz not null default now(),
  actor text,
  action text,
  detail text default ''
);

alter table public.audit_log enable row level security;
create policy "audit_select" on public.audit_log for select using (public.can_view());
create policy "audit_insert" on public.audit_log for insert with check (public.can_view());

-- ---------------------------------------------------------------------------
-- Seed the reusable action-plan templates (the only "default data" a fresh
-- install should have -- see src/data/seed.js DEFAULT_DATA for the source).
-- ---------------------------------------------------------------------------
insert into public.action_plan_templates (title, category, description, steps) values
  (
    'Pacing Recovery Plan', 'Pacing',
    'For teachers 4+ days behind the pacing guide with limited formative checks.',
    '[
      {"id": "tpl_pr_s1", "description": "Co-plan a compressed pacing map for the current unit", "defaultOwner": "Coach"},
      {"id": "tpl_pr_s2", "description": "Embed a formative check every 15 minutes", "defaultOwner": "Teacher"},
      {"id": "tpl_pr_s3", "description": "Schedule a follow-up observation focused on pacing and checks for understanding", "defaultOwner": "Coach"}
    ]'::jsonb
  ),
  (
    'Engagement & Rigor Plan', 'Instruction',
    'For classrooms with low observed engagement or passive student participation.',
    '[
      {"id": "tpl_en_s1", "description": "Model one active-processing structure (turn-and-talk, whiteboard relay, etc.)", "defaultOwner": "Coach"},
      {"id": "tpl_en_s2", "description": "Add one formative check for understanding per lesson segment", "defaultOwner": "Teacher"},
      {"id": "tpl_en_s3", "description": "Co-observe a peer classroom using the structure", "defaultOwner": "Coach"}
    ]'::jsonb
  ),
  (
    'Assessment Readiness Plan', 'Assessment',
    'For teachers with a downward assessment trend or low proficiency ahead of an upcoming unit test.',
    '[
      {"id": "tpl_ar_s1", "description": "Review item-level results from the most recent unit test", "defaultOwner": "Coach"},
      {"id": "tpl_ar_s2", "description": "Build a targeted reteach block for the lowest-proficiency standard", "defaultOwner": "Teacher"},
      {"id": "tpl_ar_s3", "description": "Give a low-stakes formative check before the next unit test", "defaultOwner": "Teacher"}
    ]'::jsonb
  ),
  (
    'New Teacher Onboarding Support', 'Onboarding',
    'General first-90-days support plan for a new or early-career teacher.',
    '[
      {"id": "tpl_nt_s1", "description": "Weekly check-in for the first six weeks", "defaultOwner": "Coach"},
      {"id": "tpl_nt_s2", "description": "Share the pacing guide and current unit map", "defaultOwner": "Coach"},
      {"id": "tpl_nt_s3", "description": "Pair with a grade-level or department mentor", "defaultOwner": "Coach"}
    ]'::jsonb
  );
