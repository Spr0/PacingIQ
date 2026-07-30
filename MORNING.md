# Morning handoff — 2026-07-30

Everything from the grilling session is built, tested, and deployed. Live bundle is
byte-identical to the build I verified. **Two things need you** (both SQL, ~1 minute).

---

## 1. Run this SQL — required

### a) Migration 004 (unlocks the "Done" button)

Paste into Supabase → SQL Editor → Run. Until this runs, the Schedule page works
fine but the manual Done button stays hidden (deliberately — it self-detects the
missing column rather than offering a button that errors).

```sql
alter table public.schedule_entries
  add column if not exists done_at timestamptz,
  add column if not exists done_by text;

select count(*) as schedule_entries, count(done_at) as marked_done
from public.schedule_entries;
```

### b) Restore Angelica's password gate — I consumed it

I used her flag to verify the RPC actually clears only that column and can't touch
`role`. She'll skip the "Set your password" screen until you run this:

```sql
update public.profiles set must_change_password = true
where lower(email) = 'angelicae@susd12.org';
```

## 2. Set the password policy — recommended before you hand out logins

**Authentication → Sign In / Providers → Email** → minimum length 10, require mixed
case + digits. Without it, `Stacy2027` passes the forced-change gate and nothing is
really gained.

Then hand out the temporary passwords (`Firstname2026`, capital first letter). Each
person sets their own on first sign-in and you never hold their password again.

---

## What shipped

| | |
|---|---|
| **Security** | Anonymous access closed. Was handing every visitor `coach` — full write/delete on 48 teachers' records. |
| **Sign-in** | Email + password, 6 accounts, real roles incl. the new ABSS. No email anywhere in the login path. |
| **Permissions** | Principal/AP/ABSS can add observations, notes, action steps; edit only their own; cannot delete. Coach-only delete. Enforced in Postgres, not just the UI. |
| **Accountability** | Audit log names real people. Was `"Guest (Instructional Coach)"` for everything. |
| **First-login gate** | Forced password change, no skip, no email. |
| **504 fix** | Calendar reader chunks 3000→1200 chars; measured 23.6s → ~10s against a ~26s ceiling. Spreadsheet padding stripped. Error message no longer blames your API key. |
| **Rotation** | Now spreads 48 teachers ~5/day across all 10 weekdays (was 8/day for 6 days, 4 dead days). Auto-generates the next cycle when one ends. |
| **Export** | One `.ics` (all-day event per day, teachers in the body), CSV, and print. Coach + leadership only; teachers never notified. |
| **Dashboard** | "Today's rotation" card — today's visits with done/pending, rest of week below. |

## Bugs I found along the way that you didn't ask about

1. **Approved users intermittently saw "Waiting on access."** `getMyProfile()` called
   `supabase.auth.getUser()` from inside the `onAuthStateChange` callback. supabase-js
   holds an auth lock while dispatching that callback, so the nested call deadlocked —
   the profile read never settled and the catch turned it into "no role." Would have hit
   Stacy at random. Fixed by using the id the callback already provides.

2. **`isoDate()` returned the previous day east of UTC.** Same class as the `parse()`
   bug fixed in `ff6ace9`. Harmless in Arizona, wrong anywhere east of UTC — every
   "is this today?" comparison off by one.

3. **`canEditNote()` was dead code** — defined, never called. So the "notes are owned by
   their creator" protection in the spec was never actually enforced. Now real, in RLS.

4. **`loadAll()` rejected wholesale if any single table failed** — one missing table
   blanked every page. Now degrades per-collection.

## Verified

- All 6 logins, correct roles. Anonymous returns `422 anonymous_provider_disabled`.
- Permission matrix tested against the live DB: principal can add; cannot forge another
  person's authorship; AP cannot overwrite Angelica's note; principal can edit her own;
  principal and ABSS cannot delete; coach can. Self-promotion via `profiles` blocked.
- 45 unit assertions across rotation maths, export formats, date handling, and the
  spreadsheet tidier (including "no non-empty value is ever lost").
- Rotation persisted and confirmed in the DB: 10 weekdays, 5/5/5/5/5/5/5/5/4/4 = 48,
  every teacher once, no weekends.
- Audit log now reads `Angelica Encinas (Principal)`.

## Open / deferred

- **Deferred by choice:** faster model for extraction, background function for very large
  calendars. Only needed if Stacy still hits the 504 on a full-year file — one quarter at
  a time should be fine now.
- **Not done:** nothing else from the grilling list.
- The rotation currently starts **Thu Jul 30**. Regenerate from the Schedule page if you
  want a different start date.
