# PacingIQ

**Instructional Coaching & Pacing Intelligence Platform** — a secure leadership
tool that helps instructional coaches, principals, and assistant principals
monitor teacher pacing, document coaching, track interventions, and keep
assessment readiness on track.

Data is real and persistent (Supabase/Postgres, with real magic-link sign-in),
currently running as a **trial** with one school. The path to a full district
rollout is Microsoft Copilot / Power Platform (Workspace SSO, multi-tenancy,
Dataverse) — the data layer is deliberately isolated in `src/data/store.js` so
that move stays a contained change.

## Stack

- React 18 + Vite
- React Router
- Supabase (Postgres + Auth + Row Level Security) for all persistent state and
  sign-in — see `supabase/schema.sql` for the schema and RLS policies
- Netlify for hosting (static SPA + serverless functions)

## Running locally

Node 20+ is required.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
```

Requires a `.env.local` with a Supabase project's URL and anon key:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
```

See "Supabase setup" below to create the project and run the schema.

## What is in this slice

The first deployable slice covers the daily-driver coaching loop:

- **Dashboard** — Monday priorities in spec order: teachers behind pace, not
  recently seen, assessment performance, coaching action plans, risk-score
  distribution, and upcoming unit tests.
- **Teachers** — roster plus a per-teacher record hub (observations, pacing,
  assessments, interventions, coaching notes) with an explainable risk score.
- **Observations** — full observation form (evidence, engagement, strengths,
  growth areas, action items, follow-up), a 14-day compliance view, and the
  leadership-controlled teacher-sharing privacy model.
- **Pacing** — weekly pacing entry with green/yellow/red rules, exception
  tracking, and the automatic triggers (alerts, intervention, coaching meeting).
- **Interventions** — the Red-status workflow: case, action plan, coaching
  meeting, follow-up observation, and leadership review, with a teacher staying
  Red until all requirements are met.
- **Coaching Impact Report** — the primary single-page school-health view.
- **Audit Log** — activity and change history, including sign-ins.
- **Action Plans** — reusable common templates plus editable teacher-specific
  plans, created from a template or from scratch.
- **Goals** — a single target per teacher (owner, target date, status) that
  appears in that teacher's outstanding action items everywhere the app shows
  them (Overview tab, Dashboard, Coaching Impact Report, Weekly Email) until
  marked Complete. A goal with a target date can be pushed to the coach's
  Google Calendar or Outlook via their own web "add event" link, or downloaded
  as a `.ics` file — real, working links, no OAuth required. Automatic
  two-way sync (a goal edit updating an existing Google Classroom/Outlook
  event) is a fast-follow; see below.
- **Attachments** — files (PDFs, photos, student work, forms) attached to
  observations. File bytes are stored in Netlify Blobs via serverless
  upload/get/delete functions; observation records keep only the blob key and
  metadata. Moving to Dataverse / district blob storage is a re-platform concern.
- **Multi-subject pacing** — elementary/multi-subject teachers get independent
  pacing status per subject everywhere pacing is shown.

### Roles and sign-in

Sign-in is a magic link (email only, no password) via Supabase Auth. A brand
new sign-in gets the `pending` role and sees a "waiting on access" screen —
nobody gets real access just by showing up. A coach or admin has to open the
Supabase dashboard (Table Editor → `profiles`) and set that person's `role`
column by hand; there's no in-app way to grant a role, on purpose.

- **Instructional Coach** — full read/write access.
- **Principal / Assistant Principal** — view everything and run reports;
  cannot edit coaching notes; can record the leadership review on interventions.

## Supabase setup

1. [supabase.com/dashboard](https://supabase.com/dashboard) → New project.
2. Project Settings → API → copy the Project URL and the `anon`/`public` key
   into `.env.local` (local dev) and the Netlify site's environment variables
   (production — Vite bakes these in at build time, so a Netlify env var
   change needs a redeploy to take effect). Never use the `service_role` key
   or the database password client-side.
3. SQL Editor → New query → paste the entire contents of
   `supabase/schema.sql` → Run. This creates every table, the RLS policies,
   the `profiles`-on-signup trigger, and seeds the four reusable action-plan
   templates.
4. Authentication → Providers → confirm Email is enabled (it is by default;
   that's all magic-link sign-in needs).
5. Sign in once through the app with the first real coach's email, then in
   Table Editor → `profiles`, change that row's `role` from `pending` to
   `coach`. That person can't do this for themselves — someone has to do it
   from the Supabase dashboard the first time.

## AI Coaching Assistant

The teacher record has an **AI assist** action (coach role) that drafts coaching
summaries, principal reports, follow-up emails, meeting agendas, and action
plans, grounded in the teacher's own records. Every draft is editable and
**requires human approval before it is saved**; nothing is sent automatically.

Live generation runs through a Netlify Function (`netlify/functions/coach-assist.js`)
that calls the Anthropic API. Set two environment variables in the Netlify site
settings:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (for example `claude-opus-4-8`; there is no default, so a
  missing value fails loudly in config rather than silently in production)

In the plain `npm run dev` preview the function does not run, so the assistant
falls back to a locally templated draft (clearly labeled "demo"). To exercise
the live function locally, run `netlify dev` with the env vars set.

## AI Lesson Plan Reader

From a teacher record, **Read Lesson Plan with AI** (coach role) reads a pasted
lesson plan (or an uploaded PDF, Excel, or CSV file, handled the same way as the
Pacing Calendar Reader) and extracts the unit, lesson, standard, objective,
assessment references, and any pacing concerns. The coach reviews and edits
every field, then **Apply to this week's pacing** writes it to that teacher's
(and subject's, if multi-subject) current-week pacing entry. Nothing is applied
automatically.

Runs through `netlify/functions/lesson-reader.js` (same `ANTHROPIC_API_KEY` /
`ANTHROPIC_MODEL` config as the Coaching Assistant), with a locally templated
regex-based read as the offline demo fallback.

## AI Pacing Calendar Reader

From the Pacing page, **Import Pacing Calendar with AI** (coach role) is the
manual-upload path for the Pacing Calendar Module: paste a scope-and-sequence
or syllabus, or upload a **PDF, Excel (.xlsx/.xls), or CSV** file, and the
assistant breaks it into a week-by-week table of units, lessons, standards, and
assessment dates. The coach reviews and edits every row, then **Approve and
Import** bulk-creates pacing entries and upcoming assessment records. Nothing is
imported automatically.

Uploaded files are reduced to text in the browser and then flow through the same
reader as pasted text: CSV/TXT directly, Excel via SheetJS, and PDF via pdf.js
(both loaded on demand from their ESM CDNs, so nothing is added to the bundle).
Because extraction is client-side, uploads work the same in local dev (offline
demo read) and on the deployed site (live read); scanned PDFs with no selectable
text are rejected with a note to paste the text instead. Same
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` config as the other AI features.

## Fast-follow (not yet built)

The weekly intelligence email, AI lesson/calendar reader, action plans, and
file attachments (now on Netlify Blobs) are built. Still to come, and blocked
on real OAuth credentials this environment doesn't have:

- **Live Google Classroom sync** — the AI Pacing Calendar Reader covers the
  spec's manual-upload path today; direct Classroom sync needs a registered
  Google Cloud OAuth client.
- **Live Google Calendar integration** — meeting agendas are already AI-
  generated (Coaching Assistant); creating real calendar invitations needs the
  same OAuth setup. Goals already export to Google Calendar / Outlook via
  their own web links and `.ics` (see Goals above); automatic two-way sync —
  a goal edit or completion updating an event already on the coach's calendar
  — needs the same OAuth client.
- **Dataverse re-platform** — structured data is on Supabase/Postgres and
  attachments are on Netlify Blobs, both real and persistent; there is no
  demo size ceiling anymore. Moving all persistence onto district Dataverse
  / blob storage for a full rollout (vs. the current trial) is isolated to
  `src/data/store.js` and the attachment functions.
- **District SSO** — sign-in is Supabase magic-link today, workable for a
  trial. Tying it to the district's actual Google Workspace or Microsoft 365
  accounts needs an OAuth app registered with district IT.

## Architecture notes

- `src/data/store.js` is the **only** module that touches the backend
  (Supabase). It keeps the same `insert`/`update`/`remove`/`getAll` shape
  every page already called back when this was `localStorage`, so swapping
  it for Dataverse / API calls later stays a contained change.
- `supabase/schema.sql` is the source of truth for the database: one table
  per `store.js` collection, plus `profiles` (auth user → name/role). Nested
  arrays that used to be embedded JS objects (action items, agreed actions,
  plan steps) are `jsonb` columns rather than their own tables, to keep the
  Postgres move contained.
- `src/lib/intelligence.js` holds all derived logic (pacing status, risk score,
  rollups, recommendations) and is UI-independent.
- `src/lib/permissions.js` centralizes the role/permission model; RLS
  policies in `supabase/schema.sql` enforce the same rules at the database
  level, not just in the UI.
