# PacingIQ — context handoff

Written 2026-08-06. Supersedes the version in commit `c55ccaa`. Everything below
was verified on that date; re-check anything you're about to act on.

---

## What this is

An instructional-coaching app in **daily production use** by six named staff at
Sunnyside USD (susd12.org), holding **real records for 50 teachers**. Not a demo.
Mistakes here are visible to a principal and two APs, and can corrupt a teacher's
evaluation record.

- Repo `Spr0/PacingIQ`, branch `main`. React 18 + Vite, React Router, plain CSS.
- Deploy: Netlify (`pacingiq.netlify.app`), git-connected — **push to `main` deploys**.
- Data: Supabase project `trvpstqcgeakctzeaubw`. RLS is the real security boundary.
- Local: `/Users/scotthenderson/Downloads/pacing-iq`. `npm run dev` via `.claude/launch.json`.

### The people

| Person | Email | Role | Notes |
|---|---|---|---|
| Stacy Eilander | stacys@susd12.org | coach | **the primary user**; "she" in Scott's messages |
| Scott Henderson | scott23henderson@gmail.com | coach | the builder |
| Angelica Encinas | angelicae@susd12.org | principal | |
| Vicki Stailey | vickis@susd12.org | ap | |
| Shane Bentley | shaneb@susd12.org | ap | |
| Kerri Ravenscroft | kerrir@susd12.org | abss | displays literally as "ABSS" |

Stacy and Scott have set their own passwords. As of 2026-07-31 the other four
were still on the temporary `Firstname2026` and will hit the forced-change gate
on first sign-in. Unconfirmed since.

### Permission model

All six can create observations, coaching notes, and action steps, and edit
**only their own**. **Delete is coach-only.** Enforced in `migrations/002`;
mirrored (not enforced) by `src/lib/permissions.js` — `canEditRecord` /
`canDeleteRecord`.

---

## Operating rules learned the hard way

1. **Never trust that a console step was done — probe the behaviour.** Supabase
   and Netlify consoles fail quietly. Probing works: an unauthenticated
   PostgREST call returns `[]` for a table that exists with RLS denying, and
   `PGRST205` for one that doesn't. That three-way control test is how migration
   006 was confirmed rather than believed.
2. **Give Scott SQL inline in a fenced block, never a file path.** He pastes
   straight into the SQL Editor.
3. **Migrations are applied by hand.** `001..006` all applied as of 2026-08-06.
4. **Verify against the live database, not the local build.** Dev and production
   point at the same Supabase project.
5. **Don't set anyone's password or create accounts** — that's Scott's to do.
6. **Never deploy a Netlify Function change without `npx netlify-cli build`
   first**, then unzip `.netlify/functions/<name>.zip` and `require()` the
   bundled file to assert `typeof m.handler === 'function'`. Source-level tests
   pass while the *bundle* is broken. See the outage below.
7. **A green test can still prove nothing.** Twice, a test passed against a
   mirrored copy of the logic and only found the truth when run against the real
   module. Prefer bundling the real thing (esbuild, with `import.meta.env`
   defined and the session stubbed) over reimplementing it.

---

## I cannot sign in

There is no login for me and I must not create one, so **no authenticated page in
this app has ever been clicked through by me**. Everything claimed below was
verified by one of: a pure-function test under `node`, a bundled-real-module
test, a production HTTP probe, or an unauthenticated PostgREST probe. Where
something is only reviewed, it says so.

Techniques that work around this are in the user memory file
`project_pacingiq_verification_ceiling.md`.

---

## What happened since the last handoff

Twelve commits. The four-part bug sweep from the previous handoff has been worked
through; what remains is under **Still open**.

### The security fix, and the outage it caused

All six Netlify Functions were on public URLs with **no auth check** —
`DELETE /.netlify/functions/delete-attachment?key=…` destroyed any attachment in
the district, from anywhere. Closed in `fcc2d9f`: every function now verifies the
caller's Supabase token against `/auth/v1/user`, then reads their role from
`profiles` with that same token so RLS governs the role lookup too. Never a
service-role key. Config reuses the `VITE_SUPABASE_*` pair already on the site,
so there was nothing to add in the console.

**That deploy took production down for 12 minutes.** The root `package.json` is
`"type": "module"`, so esbuild treated the CommonJS functions as ESM and
`exports.handler` never became an export — Netlify answered every call with
`502 Runtime.HandlerNotFound`. Only functions that `require()` a *local* file
trip it, which is why adding `_shared/auth.js` broke all six at once. Fixed in
`f3cb883` with `netlify/functions/package.json` = `{"type":"commonjs"}`.

**esbuild had been printing the exact remedy as a bundling warning on every
previous deploy, unread.** That is also how `upload-attachment` was found to have
been dead in production since June: it is the one pre-existing function with a
local require, and the "storage function is not deployed here" error in the last
handoff was this, misdiagnosed as a storage problem.

### Everything else fixed

- **`b5cffee` — Approve-and-save destroyed every AI report it accepted.** It
  wrote to `teachers.ai_drafts`, a column that never existed, unawaited, with the
  success banner and textarea-clear firing regardless. It failed that way on
  every use since the feature shipped. Now a real table (`migrations/006`),
  chosen over a jsonb column because `teachers_update` is coach-only — which
  would have left the feature broken for four of the six users. **Drafts approved
  before 2026-08-03 are unrecoverable.**
- **`7369d70` — opening the Schedule page could delete the previous cycle.** The
  auto-advance called `generate()` from a mount effect, and that path deletes
  every row before inserting. The first person to open the page on a Monday
  destroyed the finished cycle and every `done_at` tick — per `migrations/004`
  the only record of a visit walked without a write-up. It appends now.
- **`aa8b275` — nine writes that claimed success without waiting.** Chief among
  them the share-with-teacher toggles, gated on `writable` when RLS needs
  coach-or-owner: leadership could believe a teacher could see feedback she could
  not. Now gated on ownership. Also fixed here: LessonPlanReader derived "this
  week" as `max(weekOf)` across all teachers — measured **ten months wrong**
  against a real year-long import.
- **`cc4df5b` — one pacing calendar imports to a whole grade-level team.**
  Teacher is a filtered checklist now. The in-batch assessment dedup had to be
  re-keyed by teacher; without that, teacher A got the assessment and B and C got
  none, silently.
- **`7d236ae` — Approve and Import now says why it is disabled.** Reported live
  by Stacy. Also fixed a sticky `.modal__foot` that swallows clicks — not her
  actual blocker, but the same failure dressed as a working control.
- **`ca6d65c` — "reload", not "sign in", when a tab outlives a deploy.** A 401
  while the browser still holds a valid session can only mean a stale bundle.
- **`b0f08dc` + `bf08593` — PDF pacing calendars.** See below.

### The PDF calendar saga (two rounds, worth reading)

**Round one.** `extractPdfText` joined text items with spaces and pages with
`\n`, so **a PDF became one line per page**, and `chunkCalendar` only ever
started a new chunk *between* lines. A page went to the model whole, several
times the measured-safe size, and 504'd. The error told the coach to upload a
smaller section, which could not help — the size of her file was never the
problem. Fixed by honouring pdf.js's `hasEOL` (verified against pdfjs-dist
4.7.76 with a hand-built PDF: old = 1 line, new = 3) and pre-splitting over-long
lines.

**Round two, same error the next day.** `mapLimit` awaits `Promise.all`, so **one
failing section rejected the whole read**. Most sections came back fine, one
dense one exhausted the bisect, and every success was discarded — after being
paid for. Partial reads are now kept, and the modal says how many sections were
skipped.

The lesson worth carrying: round one's fix was correct, and the symptom was
identical afterwards. **Do not assume yesterday's fix covers today's repeat.**

---

## Cost

**$9.54 in July, $3.09 in the first six days of August** — roughly a $16/month
run rate. PacingIQ is the only thing on the API account. Most of August is the
two science-calendar imports on the 3rd; call it ~$1.50 per year-long PDF import.

Check it at [platform.claude.com/cost](https://platform.claude.com/cost), or via
`/v1/organizations/cost_report` with an **Admin** key (`sk-ant-admin01-…`, not
the app's key). Max 31 daily buckets per request; the project began 2026-06-30.

**`ANTHROPIC_MODEL` is set only in Netlify.** Nothing in the repo records its
value, and both `README.md` and `netlify.toml` say "e.g. `claude-opus-4-8`". The
usage report shows Opus-heavy with a little Sonnet; since all three functions
read the same env var, **the Sonnet is not this app**.

**Open decision: split the model per function.** Calendar and lesson reading are
structured extraction behind a human-approval gate, so a weaker extraction is
visible and correctable — low-risk to drop a tier. `coach-assist` writes
principal-facing prose and is one call per report versus ~50 per import, so it
should stay on Opus. The argument is **latency, not cost**: the binding
constraint is the ~26s function budget, and every 504 triggers a bisect whose
retries are themselves paid calls. Measure before switching — re-run a calendar
Stacy has already imported and compare drafts.

---

## Still open

Roughly in the order I'd take them.

1. **Two leadership-facing numbers are wrong** (`intelligence.js`), both feeding
   the Coaching Impact Report Angelica sees:
   - **"No pacing data" reports as on-pace / green.** `daysBehind = pacing ? … : 0`
     → `pacingStatus(0)` → green, and `riskScore` adds no factor. The observation
     path deliberately distinguishes null ("Never observed", +20); pacing has no
     equivalent. Demonstrated: 5 teachers, 2 with any pacing data, report claims
     **80% on pace**.
   - **Stale pacing is presented as the current slip, with no age shown.**
     `pickCurrentWeek` returns the latest week that has *started*, however old,
     and nothing on the rollup carries `weekOf`. A ten-week-old "5 days behind"
     is indistinguishable from today's, and `recommendedAction` will tell the
     coach to open an intervention on it.
2. **`tidyTabularText` corrupts multi-line spreadsheet cells** (`fileExtract.js`).
   It splits on `\n` before parsing quotes, and `splitRow` resets quote state per
   line. An alt+enter inside an Objective or Notes column — which `sheet_to_csv`
   correctly emits inside quotes — tears the row in half and loses its standard.
   Silent, and the tidied text is what the coach reviews, so the review sees
   already-corrupted input.
3. **An audit-log failure causes duplicate real records.** The audit write happens
   after the record write inside the same `try`, so a failed audit reports the
   *record* save as failed; the coach retries and gets a second observation.
   There is **no unique constraint anywhere in the schema** to stop it.
4. **A transient profile-fetch failure ejects an approved user.** `AuthContext`'s
   `catch { setProfile(null) }` conflates "request failed" with "no profile", so a
   brief Wi-Fi drop during a token refresh drops a coach to "Waiting on access"
   and unmounts her unsaved form.
5. **Weekly pacing overwrites last week** for any school that hasn't imported a
   calendar: `currentWeek` resolves to the latest already-recorded week, so the
   second week's entry updates the first. Pacing history never grows.
6. **`chunkCalendar` duplicates the first data row into every chunk** when a file
   has no header row — the only test is `length <= 300`.
7. **`store.remove` can't tell a denied delete from a successful one** — no
   `.select()`, so an RLS refusal resolves as success and the row reappears on
   refresh.
8. **A teacher can never be reduced from two subjects to one** —
   `TeacherDetail.jsx:111` passes `undefined`, which `patchToSnake` skips, so the
   `subjects` array is never cleared.
9. **Accessibility, systemic.** `Field` doesn't associate its label (`ui.jsx` —
   the `<label>` is a sibling with no `htmlFor`), so every form control in the app
   is unlabelled to a screen reader. `Modal` has no `role="dialog"`, no Escape
   handler, no focus trap. `Schedule.jsx` is the one place labels are done right.
10. **No holiday calendar in the data model** — `buildCycleEntries` will happily
    schedule 2027-01-01. A known gap, not a logic error.

### Latent, currently DB-guarded

`pacingStatus('four')` returns green (`Number(x) || 0`); `parse('2026-02-30')`
rolls over to 2026-03-02. Neither can reach stored data — `days_behind` is a NOT
NULL integer and date columns reject invalid input — so these surface only in a
pre-save AI-import preview.

### Confirmed **not** bugs

Stated so they aren't re-investigated: no `.sort()` on state or props anywhere;
list keys are present and stable; `createdById` stamping can't be spoofed; role
escalation through the app is closed (no insert/update/delete policy on
`profiles`); the attachment `pendingKeys`/`removedKeys` lifecycle is correct; the
`onAuthStateChange` deadlock is fixed. Date handling in `dates.js` is correct
across both DST transitions and the year boundary. `scheduleExport.js` ICS folding
round-trips exactly, including em dashes and accented names. `buildCycleEntries`
is correct at 0, 1, and 48 teachers, with no weekend dates and everyone exactly
once.

Note that **`schema.sql` read alone is misleading** — it still shows the old
coach-only policies that `migrations/002` rewrites. The migrations are the truth.

---

## Open items needing Scott

1. **Confirm the other four have signed in** and changed off `Firstname2026`.
2. **Decide the model split** (see Cost). If wanted, it's one env var plus a
   fallback so nothing breaks when it's unset.
3. **Give PacingIQ its own Anthropic API key** if it doesn't have one. Per-project
   cost questions are only answerable if the key is per-project.
4. **`PacingIQ dashboard layout.zip`** is sitting untracked in the repo root.
   Unknown provenance; nothing reads it.
