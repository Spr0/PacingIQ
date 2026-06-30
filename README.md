# PacingIQ

**Instructional Coaching & Pacing Intelligence Platform** — a secure leadership
tool that helps instructional coaches, principals, and assistant principals
monitor teacher pacing, document coaching, track interventions, and keep
assessment readiness on track.

This repository is a **demo prototype**. It runs entirely in the browser on
`localStorage` with a mock role switcher, and is intended to be demoed and then
re-platformed onto a Microsoft Copilot / Power Platform instance inside a school
district (which provides real Workspace SSO, multi-tenancy, encryption, and
audit storage). The data layer is deliberately isolated so that re-platform is a
contained change.

## Stack

- React 18 + Vite
- React Router
- `localStorage` for all persistent state (one swappable module)
- Netlify for hosting (static SPA)

## Running locally

Node 20+ is required.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
```

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
- **Audit Log** — activity and change history.

### Roles (mock auth)

Switch roles from the top bar. There is no real login in the demo.

- **Instructional Coach** — full read/write access.
- **Principal / Assistant Principal** — view everything and run reports;
  cannot edit coaching notes; can record the leadership review on interventions.

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

## Fast-follow (not yet built)

The weekly intelligence email is built (see Weekly Email). Still to come: the AI
lesson/calendar reader, Google Classroom and Google Calendar integration, and
file storage.

## Architecture notes

- `src/data/store.js` is the **only** module that touches `localStorage`. Swap
  its function bodies for Dataverse / API calls to re-platform.
- `src/lib/intelligence.js` holds all derived logic (pacing status, risk score,
  rollups, recommendations) and is UI-independent.
- `src/lib/permissions.js` centralizes the role/permission model.
