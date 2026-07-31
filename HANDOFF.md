# PacingIQ — context handoff

Written 2026-07-31. Supersedes `MORNING.md`. Everything below was verified against
the live system on that date; re-check anything you're about to act on.

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

Stacy and Scott have set their own passwords. **The other four are still on the
temporary `Firstname2026`** and will hit the forced-change gate on first sign-in.

### Permission model

All six can create observations, coaching notes, and action steps, and edit **only
their own**. **Delete is coach-only.** Enforced in `migrations/002`; mirrored (not
enforced) by `src/lib/permissions.js` — `canEditRecord` / `canDeleteRecord`.

---

## Operating rules learned the hard way

1. **Never trust that a console step was done — probe the behaviour.** Supabase and
   Netlify consoles fail quietly. An "anonymous sign-ins off" toggle that hadn't
   saved was still handing out coach tokens; an "Invite user" that reported success
   had created accounts with no password.
2. **Give Scott SQL inline in a fenced block, never a file path.** He pastes
   straight into the SQL Editor — a path once went in verbatim and errored.
3. **Migrations are applied by hand.** `supabase/migrations/001..005` are all applied
   as of 2026-07-31. Check the live DB rather than assuming.
4. **Verify against the live database, not the local build.** Both the dev server and
   production point at the same Supabase project.
5. **Don't set anyone's password or create accounts** — that's Scott's to do.

---

## Recent history (this session)

Closed a live security hole: anonymous sign-in was auto-granting **coach** to every
visitor — full write and delete on 50 teachers' records. Replaced with per-person
email+password (magic links are unusable: district mail filtering blocks Supabase's
outbound email, which is also why dashboard "Invite user" fails). Added the `abss`
role, record ownership, coach-only delete, a forced first-login password change,
and real user attribution in the audit log (it used to say "Guest").

Also: fixed a blank-page-until-refresh hang; built the observation rotation
(randomised, ~5/day across 10 weekdays, auto-advancing) with `.ics`/CSV/print export;
fixed the AI calendar reader's 504s and its habit of inventing years; separated
coaching notes from classroom observations so desk notes stop counting as visits;
and today rewrote the dashboard as a triage queue.

Full detail is in the git log — commit messages explain *why*, not just what.

---

## Open items needing Scott

Nothing is blocking, but these are outstanding:

1. **Tell the other four their temporary password** (`Firstname2026`, capital first
   letter). They'll be forced to change it on first sign-in.
2. **Delete a leftover test row** I created and cannot remove (delete is coach-only
   and I have no coach password):
   ```sql
   delete from public.observations where strengths like 'OWNERSHIP UI TEST%';
   ```
3. **Olivia Mandros' imported pacing has no subject attached** (shows "—"). Picking
   the Subject dropdown before importing files it under ELA properly. Cosmetic.

---

## Bug sweep, 2026-07-31

Four parallel audits over the data/auth layer, derived logic, pages/components, and
the AI/serverless layer. **Two app-breaking bugs found and already fixed** (commit
`d142675`); the rest are catalogued below, unfixed, roughly in severity order.

I verified the CRITICAL and HIGH items myself by reading the code. Items marked
*(reported)* came from the sweep and are worth confirming before acting.

### Fixed today

- **Delete observation never worked.** `teacherName` is a lookup map, not a function;
  `teacherName(id)` threw above the `try`, so the button was inert — no confirm, no
  delete, no error. Added yesterday for exactly this job; never once worked.
- **After one save, no further observation could be saved.** `setSaving(false)` was
  only in the `catch`, so the success path left the flag true and the button stayed
  greyed out as "Saving…" for the rest of the visit, losing typed input on navigation.
- **"Reshuffle upcoming" could strand an entire cycle in the past.** The
  "already seen" lookback was `SEEN_WINDOW_DAYS`, but a 10-weekday cycle is ~14
  calendar days, so visits from the *previous* cycle pinned teachers to dates already
  gone. Proven: six teachers visited 3–8 days ago → all six rows moved into the past
  with nobody scheduled ahead. The page would read 100% done, `cycleHasEnded()` would
  flip true, and the unattended auto-advance would then delete the table. A pin can no
  longer land before today.
- **Un-taken assessments read as a score collapse.** `assessmentTrend` used
  `avgScore || 0`, so an upcoming test (null score) counted as zero. A year-long
  calendar import creates one null row per unit test, so this fired on most of the
  roster: 88 → 91 → un-taken reported "down", set `assessmentConcern`, and added 15 to
  the risk score, while the dashboard showed a red downward arrow beside a rising
  score. Trend and concern now consider only scored tests.

### CRITICAL — unauthenticated serverless functions

**Verified.** `grep` for any auth reference across `netlify/functions/*.js` returns
nothing. All six functions are on a public URL with no session check.

- `delete-attachment.js` — `DELETE ?key=<key>` deletes any blob, no auth. Attachment
  keys are readable by every `can_view()` role (they're on the observation row), so a
  principal/AP/ABSS — explicitly *not* allowed to delete observations — can harvest
  every key and destroy all observation evidence in the district. RLS never sees it.
- `get-attachment.js` — same shape for reads: any key returns the bytes.
- `coach-assist.js`, `calendar-reader.js`, `lesson-reader.js` — an unauthenticated,
  unmetered Claude proxy on `ANTHROPIC_API_KEY`. A stranger can loop curl until the
  account cap trips, which also takes the tool down for Stacy. `coach-assist` passes
  caller-controlled `context` straight into `messages` without validating it's a
  string.
- `upload-attachment.js` — unauthenticated writes into Netlify Blobs; the key is
  built from unsanitised form fields.

**Fix:** verify a Supabase JWT in every function, and for get/delete confirm the
caller can view the owning observation. This is the first thing I'd do.

*(The `ANTHROPIC_API_KEY` itself does not leak to the browser — verified. `.env.local`
holds only the Supabase URL and anon key.)*

### CRITICAL — AI draft approval silently discards the work

**Verified.** `src/components/CoachAssistant.jsx:105` writes `{ aiDrafts: [...] }` to
`teachers`. There is **no `ai_drafts` column** — zero hits across `supabase/`. The
call is unawaited with no `.catch`, and the success banner plus `setDraft('')` run
unconditionally.

A coach generates a report, edits it, clicks *Approve and save*, sees "approved and
saved to <teacher>'s record", and the textarea empties. Nothing was written; the text
is unrecoverable; there's no audit entry. **This fails on every use of the feature.**

Fix: add the column (`alter table public.teachers add column if not exists ai_drafts
jsonb not null default '[]'`), then `await` the write and only then clear the draft.

### CRITICAL — schedule auto-advance wipes every past cycle, unattended

**Verified** — and it's mine. `src/pages/Schedule.jsx` ~111 fires `generate()` from a
`useEffect` on mount when the cycle has ended. That calls `store.replaceSchedule`,
which does `delete().not('id','is',null)` — **every row in the table** — then inserts
one fresh cycle.

Monday morning, first person to open the page (any writable role, no click, no
confirm) destroys the previous cycle including every `done_at` tick. Per
`migrations/004` those ticks are the *only* record of a visit walked without a
write-up. The three manual buttons are correctly confirmed; the automatic path isn't.

Same function: delete and insert are two round trips with no transaction. If the
insert fails after the delete commits, the schedule is left empty and the UI says
"Failed to generate the schedule. Please try again," which reads as *nothing
happened*.

Fix: the auto-advance should *append* the next cycle, not replace the table — or at
minimum prompt. And `replaceSchedule` should scope its delete.

### HIGH — writes that fail silently while claiming success

A recurring pattern: `db.*` called without `await` and without `.catch`, with a
success message set unconditionally. Every one of these can tell a coach something
saved when it didn't.

| Where | What |
|---|---|
| `Observations.jsx` share-with-teacher | **privacy control.** Gated on `writable`, but RLS needs coach-or-owner. A principal ticks "release Strengths to the teacher", RLS refuses, checkbox silently reverts. She believes the teacher can see it. |
| `Goals.jsx`, `ActionPlans.jsx` status selects | revert silently for anyone but the creator |
| `Goals.jsx`, `ActionPlans.jsx` deletes (×3) | **no confirm, no await, no catch.** One misclick destroys a plan or a school-wide shared template |
| `LessonPlanReader.jsx` apply-to-pacing | see below; banner always claims success |
| `WeeklyEmail.jsx` mark-as-sent | claims "Logged as sent" even if the audit write failed |

### HIGH — `tidyTabularText` corrupts multi-line spreadsheet cells

*(reported, and it's mine)* `src/lib/fileExtract.js` splits on `\n` **before** parsing
quotes, and `splitRow` resets its quote state per line. A cell containing a line
break — alt+enter in an Objective or Notes column, which `sheet_to_csv` correctly
emits inside quotes — is torn in half and the row's standard is lost:

```
IN   1,Unit 1,"Solve one-step equations\nand check solutions",8.EE.7
OUT  1,Unit 1,Solve one-step equations
     "and check solutions,8.EE.7"
```

The week imports with an empty standard, silently, and the tidied text is what the
coach reviews — so the review sees already-corrupted input. Fix: parse the whole text
in one pass rather than pre-splitting on newlines.

### HIGH — PDF pacing calendars can never import

*(reported)* `extractPdfText` joins a page's text items with spaces and pages with
`\n`, so a PDF becomes **one line per page**. `chunkCalendar` is line-aligned and
can't subdivide a line, and the bisect retry bails on `lines.length < 2`. Every
text-heavy PDF page becomes one ~4,000-char chunk, 3× the measured-safe size, so it
504s — and the error tells the coach to upload a smaller section, which cannot help.

### HIGH — LessonPlanReader writes pacing to the wrong week

*(reported)* It derives the current week as `max(weekOf)` across **all** teachers'
entries, not via `pickCurrentWeek`. This is the exact bug fixed in `Pacing.jsx` today
(a year-long imported calendar makes the newest row next May); this file wasn't
updated. With a calendar imported, "Apply to this week's pacing" inserts a junk row
dated months in the future and reports success.

### HIGH — two leadership-facing numbers are wrong

Both *(reported)*, both in `intelligence.js`, both feed the Coaching Impact Report:

- **"No pacing data" is reported as "on pace / green".** `daysBehind = pacing ? … : 0`
  → `pacingStatus(0)` → green, and `riskScore` adds no factor. The observation path
  deliberately distinguishes null ("Never observed", +20); pacing has no equivalent.
  Demonstrated: 5 teachers, only 2 with any pacing data, report claims **80% on pace**.
- **Stale pacing is presented as the current slip, with no age shown.**
  `pickCurrentWeek` returns the latest week that has *started*, however old, and
  nothing on the rollup carries `weekOf`. A ten-week-old "5 days behind" is
  indistinguishable from today's, and `recommendedAction` will tell the coach to open
  an intervention on it.

### MEDIUM

- **A transient profile-fetch failure ejects an approved user.** `AuthContext`'s
  `catch { setProfile(null) }` conflates "request failed" with "no profile", so a
  two-second Wi-Fi drop during a token refresh drops a coach to "Waiting on access"
  and unmounts her unsaved form.
- **An audit-log failure causes duplicate real records.** The audit write happens
  after the record write inside the same `try`, so a failed audit reports the *record*
  save as failed; the coach retries and gets a second observation. There is **no
  unique constraint anywhere in the schema** to stop it.
- **Weekly pacing overwrites last week** for any school that hasn't imported a
  calendar: `currentWeek` resolves to the latest already-recorded week, so the second
  week's entry updates the first instead of adding a row. Pacing history never grows.
- **`chunkCalendar` duplicates the first data row into every chunk** when a file has
  no header row (the only test is `length <= 300`), and there's no in-batch duplicate
  guard for pacing entries — so the same week imports N times.
- **The retry tree can reach ~60 paid API calls for one chunk**, and nothing caps
  total chunks: a 4MB workbook is ~3,300 chunks with no confirmation step.
- **A non-JSON model response returns 502**, which the client treats as a platform
  timeout and bisects three levels deep chasing a size problem that doesn't exist.
- **`store.remove` can't tell a denied delete from a successful one** — no `.select()`,
  so RLS refusal resolves as success and the row reappears after refresh.
- **Controls shown to roles the DB will refuse:** Pacing "Update", and the
  Interventions requirement toggles for `abss`. These *do* surface an error, so
  they're dead controls rather than silent corruption.
- **A teacher can never be reduced from two subjects to one** —
  `TeacherDetail.jsx:111` passes `undefined`, which `patchToSnake` skips, so the
  `subjects` array is never cleared and phantom per-subject rows persist.

### LOW / systemic

- **`Field` doesn't associate its label** (`ui.jsx` — `<label>` is a sibling with no
  `htmlFor`), so every form control in the app is unlabelled to a screen reader.
  `Schedule.jsx` is the one place done correctly.
- **`Modal` has no `role="dialog"`, no Escape handler, no focus trap.** Escape doing
  nothing is the most user-visible part.
- **`"null · 2d behind"`** renders when a teacher has both subject-tagged and
  untagged pacing rows.
- The 10MB attachment limit exceeds Netlify's ~4.5MB real ceiling, and the resulting
  error says "storage function is not deployed here".
- The PDF-as-document code path is unreachable dead code (`kind: 'pdf'` is never
  returned), which is *why* the PDF bug above bites.

### Latent, currently DB-guarded

`pacingStatus('four')` returns green (`Number(x) || 0`); `parse('2026-02-30')` rolls
over to 2026-03-02. Neither can reach stored data — `days_behind` is a NOT NULL
integer and date columns reject invalid input — so these surface only in a pre-save
AI-import preview. Worth hardening, not a live wrong number.

### Confirmed **not** bugs

Stated so they aren't re-investigated: no `.sort()` on state or props anywhere; list
keys are all present and stable; the `createdById` stamping can't be spoofed; role
escalation through the app is genuinely closed (no insert/update/delete policy on
`profiles`); the attachment `pendingKeys`/`removedKeys` lifecycle is correct; the
`onAuthStateChange` deadlock is fixed and no remaining call site can reach it;
`observations.kind` NOT NULL is set on both insert paths. Date handling in `dates.js`
is correct across both DST transitions and the year boundary. `scheduleExport.js` ICS
folding round-trips exactly, including em dashes and accented names. `buildCycleEntries`
is correct at 0, 1, and 48 teachers with no weekend dates and everyone exactly once —
though note it will happily schedule 2027-01-01, since there is **no holiday calendar
in the data model**. That's a known gap, not a logic error.

Note that **`schema.sql` read alone is misleading** — it still shows the old
coach-only policies that `migrations/002` rewrites. The migrations are the truth.

---

## Where I'd start

1. **Auth on the six Netlify functions.** Anyone on the internet can delete every
   attachment in the district.
2. **`ai_drafts`** — one column, and a flagship feature stops lying about saving.
3. **Schedule auto-advance** — it destroys visit records with nobody touching it.
4. Then the silent-failure sweep: `await` + `.catch` + an error surface on every
   `db.*` call in the table above, and gate the share-with-teacher control on
   ownership like Edit already is.
