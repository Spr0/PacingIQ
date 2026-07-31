-- ---------------------------------------------------------------------------
-- 006: a real home for approved AI drafts.
--
-- CoachAssistant has always written approved drafts to `teachers.ai_drafts`.
-- That column has never existed, the write was never awaited, and the success
-- banner fired regardless -- so every approval since the feature shipped told
-- the coach her edited report was saved and threw it away. This gives it
-- somewhere to go.
--
-- A table rather than a jsonb column on `teachers`, for three reasons:
--
--   1. `teachers_update` is coach-only. A jsonb column there would leave the
--      feature broken for the principal, both APs, and ABSS -- loudly instead
--      of silently, but still broken.
--   2. The client wrote the whole array back each time
--      (`{ aiDrafts: [...saved, entry] }`). Two people approving at once, or
--      one person in two tabs, silently drops one of the drafts. Rows don't
--      have that problem.
--   3. Ownership, per-row audit, and individual deletion come for free, in the
--      same shape as every other authored record in migrations/002.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  kind text not null,
  label text not null,
  text text not null,
  -- 'ai' when generated live by Claude, 'demo' when the offline template
  -- produced it. Worth keeping: a coach reviewing an old draft should be able
  -- to tell which one she approved.
  source text,
  language text not null default 'en',
  approved_by text not null,
  approved_at timestamptz not null default now(),
  created_by_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ai_drafts_teacher_id_idx on public.ai_drafts (teacher_id);

alter table public.ai_drafts enable row level security;

-- Same shape as observations in migrations/002: everyone with a role reads,
-- anyone who can write may create their own, edits are coach-or-owner, and
-- delete stays coach-only.
drop policy if exists "ai_drafts_select" on public.ai_drafts;
drop policy if exists "ai_drafts_insert" on public.ai_drafts;
drop policy if exists "ai_drafts_update" on public.ai_drafts;
drop policy if exists "ai_drafts_delete" on public.ai_drafts;

create policy "ai_drafts_select" on public.ai_drafts for select
  using (public.can_view());
create policy "ai_drafts_insert" on public.ai_drafts for insert
  with check (public.can_write() and created_by_id = auth.uid());
create policy "ai_drafts_update" on public.ai_drafts for update
  using (public.is_coach() or created_by_id = auth.uid())
  with check (public.is_coach() or created_by_id = auth.uid());
create policy "ai_drafts_delete" on public.ai_drafts for delete
  using (public.is_coach());

grant select, insert, update, delete on public.ai_drafts to authenticated;
