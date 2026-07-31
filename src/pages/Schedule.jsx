// ---------------------------------------------------------------------------
// Observation rotation. Randomly assigns every teacher one visit day, spread
// evenly across a 2-week (10 school day) cycle -- see lib/rotation.js for the
// cycle maths and why the roster is spread rather than packed at 8/day.
//
// When a cycle's last day has passed the next one is generated automatically,
// so the rotation doesn't quietly lapse. Exports (.ics / CSV / print) are for
// the coach and leadership only; teachers are never sent their visit date,
// which is what keeps a random pacing check meaningful.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { today, parse, isoDate, formatDate } from '../lib/dates.js';
import {
  buildCycleEntries,
  planReshuffle,
  planAddMissing,
  groupSchedule,
  cycleHasEnded,
  snapToWeekday,
  nextWeekday,
  CYCLE_WEEKDAYS,
  PER_DAY_CAP,
} from '../lib/rotation.js';
import { downloadScheduleIcs, downloadScheduleCsv } from '../lib/scheduleExport.js';
import { Card, Empty } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

function weekdayLabel(dateStr) {
  const d = parse(dateStr);
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : dateStr;
}

export default function Schedule() {
  const { teachers, scheduleEntries, observations, db, roleKey, user } = useApp();
  const writable = can(roleKey, 'write');

  const [startDate, setStartDate] = useState(() => isoDate(snapToWeekday(today())));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [calendarHelp, setCalendarHelp] = useState(null); // 'google' | 'outlook'
  const [marking, setMarking] = useState(null);  // schedule_entry id being ticked off
  const [markDate, setMarkDate] = useState('');  // which day that visit happened
  const autoRan = useRef(false);

  const { days, cycles } = useMemo(
    () => groupSchedule(scheduleEntries, teachers, observations),
    [scheduleEntries, teachers, observations]
  );

  // The manual Done toggle needs schedule_entries.done_at (migration 004).
  // Rows loaded with select('*') simply omit an absent column, so probe for
  // the key rather than assuming -- that way deploying ahead of the migration
  // hides the button instead of offering one that errors when clicked.
  const doneSupported = scheduleEntries.some((e) => 'doneAt' in e);
  // Teachers added since the schedule was made, so the button can say how many.
  const missingCount = teachers.filter((t) => !scheduleEntries.some((e) => e.teacherId === t.id)).length;

  async function generate(fromDate, auditAction = 'generated observation schedule') {
    if (!teachers.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await db.replaceSchedule(buildCycleEntries(teachers, fromDate), auditAction);
    } catch (err) {
      setError(err.message || 'Failed to generate the schedule. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Re-randomises only the teachers still to be seen. Anyone already visited
  // keeps -- and is moved onto -- the day the visit actually happened, so a
  // reshuffle never erases the record of work done.
  async function reshuffleUpcoming() {
    if (!teachers.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const plan = planReshuffle({ teachers, entries: scheduleEntries, observations, fromDate: isoDate(today()) });
      await db.replaceSchedule(plan, 'reshuffled the upcoming observation schedule');
    } catch (err) {
      setError(err.message || 'Could not reshuffle the schedule. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Slots teachers who aren't on the schedule into the days still to come,
  // leaving every existing row alone.
  async function addMissing() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows = planAddMissing({ teachers, entries: scheduleEntries, fromDate: isoDate(today()) });
      if (rows.length) await db.addScheduleEntries(rows, 'added new teachers to the observation schedule');
    } catch (err) {
      setError(err.message || 'Could not add those teachers. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Auto-advance: once the last scheduled day is in the past, lay out the next
  // cycle so the rotation never silently stops. Guarded by a ref so it fires
  // at most once per mount, and only for a role that may write.
  useEffect(() => {
    if (autoRan.current || busy || !writable || !teachers.length) return;
    if (!days.length || !cycleHasEnded(days)) return;
    autoRan.current = true;
    const from = isoDate(nextWeekday(parse(days[days.length - 1].date) || today()));
    generate(from, 'auto-generated the next observation cycle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, writable, teachers.length, busy]);

  // Google Calendar has no URL that adds events in bulk -- importing a file is
  // the only one-shot route -- so the most we can do is download the file and
  // land the user on the import screen, then say what's left. Opened in the
  // same click as the download so the popup isn't blocked.
  const GOOGLE_IMPORT_URL = 'https://calendar.google.com/calendar/r/settings/export';

  function addToCalendar(target) {
    downloadScheduleIcs(days);
    setCalendarHelp(target);
    if (target === 'google') window.open(GOOGLE_IMPORT_URL, '_blank', 'noopener,noreferrer');
  }

  // Marking a visit asks WHICH DAY it happened rather than assuming today.
  // Assuming today was wrong in practice: a coach catching up on paperwork the
  // next morning would have yesterday's classroom recorded as today's, and had
  // no way to say otherwise. The date defaults to today for the common case of
  // ticking off as you go, and can't be in the future.
  async function markDone(entry, visitedOn) {
    if (busy) return;
    try {
      await db.update(
        'scheduleEntries',
        entry.id,
        {
          doneAt: new Date().toISOString(),
          doneBy: user.name,
          // The visit day IS the schedule day once it has happened, so the
          // record shows where the work actually landed -- and pinning it this
          // way is what keeps a later reshuffle from moving it.
          ...(entry.scheduledDate !== visitedOn ? { scheduledDate: visitedOn } : {}),
        },
        'marked a scheduled visit done'
      );
      setMarking(null);
    } catch (err) {
      setError(err.message || 'Could not update that visit.');
    }
  }

  async function unmarkDone(entry) {
    if (busy) return;
    // An entry that's done only because an observation exists has nothing to
    // un-tick -- the observation is the record. Only the manual flag clears.
    try {
      await db.update('scheduleEntries', entry.id, { doneAt: null, doneBy: null }, 'un-marked a scheduled visit');
    } catch (err) {
      setError(err.message || 'Could not update that visit.');
    }
  }

  const totalDone = days.reduce((n, d) => n + d.doneCount, 0);
  const totalVisits = days.reduce((n, d) => n + d.entries.length, 0);

  return (
    <div className="stack">
      <div className="row row--between row--wrap no-print">
        <div className="row row--wrap" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="small muted" htmlFor="sched-start">
              Start date
            </label>
            <input
              id="sched-start"
              type="date"
              className="input"
              style={{ width: 165 }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!writable}
            />
          </div>
          <span className="small muted">
            {teachers.length} teacher{teachers.length === 1 ? '' : 's'} spread across{' '}
            {CYCLE_WEEKDAYS} school days, then repeats
            {totalVisits > 0 && ` · ${totalDone} of ${totalVisits} observed`}
          </span>
        </div>
        <div className="row row--wrap" style={{ gap: 8 }}>
          {totalVisits > 0 && (
            <>
              {/* Both calendar buttons download the same .ics -- the file is
                  standard and neither app is special. What differs is what
                  happens next, and that's the part people get stuck on: a
                  double-clicked .ics is opened by whatever owns the file type
                  (Outlook on a district Windows machine), which is useless to
                  someone who lives in Google Calendar. So each button states
                  its own next step, and the Google one opens the import page
                  because Google has no URL that bulk-adds events. */}
              <button className="btn btn--sm" onClick={() => addToCalendar('google')} title="Downloads the .ics and opens Google Calendar's import page">
                <Icon name="pacing" /> Google Calendar
              </button>
              <button className="btn btn--sm" onClick={() => addToCalendar('outlook')} title="Downloads the .ics for Outlook, Apple Calendar, or any other calendar app">
                <Icon name="pacing" /> Outlook / Apple
              </button>
              <button className="btn btn--sm" onClick={() => downloadScheduleCsv(days)}>
                <Icon name="report" /> CSV
              </button>
              <button className="btn btn--sm" onClick={() => window.print()}>
                <Icon name="audit" /> Print
              </button>
            </>
          )}
          {writable ? (
            totalVisits === 0 ? (
              <button
                className="btn btn--primary btn--sm"
                onClick={() => generate(startDate)}
                disabled={busy || teachers.length === 0}
              >
                <Icon name="shuffle" /> {busy ? 'Randomizing…' : 'Randomize schedule'}
              </button>
            ) : (
              <>
                {/* Three separate actions, because one "Randomize again" that
                    silently wiped completed visits is what caused a real coach
                    to lose the record of a day's work. */}
                {missingCount > 0 && (
                  <button className="btn btn--primary btn--sm" onClick={addMissing} disabled={busy}>
                    <Icon name="teachers" /> Add {missingCount} new teacher{missingCount === 1 ? '' : 's'}
                  </button>
                )}
                <button className="btn btn--sm" onClick={reshuffleUpcoming} disabled={busy}>
                  <Icon name="shuffle" /> {busy ? 'Working…' : 'Reshuffle upcoming'}
                </button>
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Start a brand new cycle? This clears the whole schedule, including visits already marked done, and randomises everyone again.'
                      )
                    )
                      generate(startDate, 'started a new observation cycle');
                  }}
                  disabled={busy}
                >
                  Start new cycle
                </button>
              </>
            )
          ) : (
            <span className="muted small">View only. Editing is limited to the coach role.</span>
          )}
        </div>
      </div>

      {error && <div className="banner banner--danger no-print">{error}</div>}

      {calendarHelp && (
        <div className="banner banner--info no-print" style={{ justifyContent: 'space-between' }}>
          <span>
            {calendarHelp === 'google' ? (
              <>
                <strong>pacingiq-observation-rotation.ics</strong> downloaded, and Google Calendar's
                import page should have opened in a new tab. There, choose <strong>Select file from
                your computer</strong>, pick that file, choose which calendar, then{' '}
                <strong>Import</strong>. Don't double-click the file itself — Windows hands it to
                Outlook.
              </>
            ) : (
              <>
                <strong>pacingiq-observation-rotation.ics</strong> downloaded. Open it to add the
                visits to Outlook or Apple Calendar. In Outlook on the web instead:{' '}
                <strong>Add calendar → Upload from file</strong>.
              </>
            )}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => setCalendarHelp(null)}>
            Dismiss
          </button>
        </div>
      )}

      {teachers.length === 0 ? (
        <Card>
          <Empty icon="🎲">Add teachers before generating an observation schedule.</Empty>
        </Card>
      ) : cycles.length === 0 ? (
        <Card>
          <Empty icon="🎲">
            No schedule yet.
            {writable ? ' Click "Randomize schedule" to assign every teacher a visit day.' : ''}
          </Empty>
        </Card>
      ) : (
        cycles.map(({ cycle, days: cycleDays }) => (
          <Card
            key={cycle}
            title={`Cycle ${cycle}`}
            count={cycleDays.reduce((n, d) => n + d.entries.length, 0)}
            action={
              <span className="small muted">
                {weekdayLabel(cycleDays[0].date)} – {weekdayLabel(cycleDays[cycleDays.length - 1].date)}
              </span>
            }
            flush
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Subject</th>
                  <th>Grade</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {cycleDays.flatMap((d) => [
                  <tr key={`${d.date}-head`}>
                    <td colSpan={4} className="schedule-daybar">
                      {weekdayLabel(d.date)}{' '}
                      <span className="muted" style={{ fontWeight: 'var(--fw-medium)' }}>
                        · {d.doneCount} of {d.entries.length} observed
                      </span>
                    </td>
                  </tr>,
                  ...d.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link className="tname" to={`/teachers/${e.teacher.id}`}>
                          {e.teacher.name}
                        </Link>
                      </td>
                      <td>{e.teacher.subject || '—'}</td>
                      <td>{e.teacher.gradeLevel || '—'}</td>
                      <td>
                        {e.done ? (
                          <span
                            className="pill pill--green"
                            title={
                              e.doneAt
                                ? `Marked done by ${e.doneBy || 'someone'} on ${formatDate(e.doneAt.slice(0, 10))}`
                                : 'An observation was logged for this date'
                            }
                          >
                            <span className="dot" />
                            {e.doneAt ? 'Done' : 'Observed'}
                          </span>
                        ) : (
                          <span className="muted small">Scheduled</span>
                        )}
                        {writable && doneSupported && !(e.done && !e.doneAt) && (
                          marking === e.id ? (
                            // Asks which day, because "I saw her yesterday" is
                            // the normal case when paperwork happens after the
                            // fact.
                            <span className="row no-print" style={{ gap: 4, marginTop: 4 }}>
                              <input
                                type="date"
                                className="input"
                                style={{ width: 140 }}
                                value={markDate}
                                max={isoDate(today())}
                                autoFocus
                                onChange={(ev) => setMarkDate(ev.target.value)}
                              />
                              <button
                                className="btn btn--primary btn--sm"
                                onClick={() => markDone(e, markDate)}
                                disabled={!markDate}
                              >
                                Save
                              </button>
                              <button className="btn btn--ghost btn--sm" onClick={() => setMarking(null)}>
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="btn btn--ghost btn--sm no-print"
                              style={{ marginLeft: 6 }}
                              onClick={() => {
                                if (e.doneAt) return unmarkDone(e);
                                setError(null);
                                setMarkDate(isoDate(today()));
                                setMarking(e.id);
                              }}
                              title={
                                e.doneAt
                                  ? 'Un-mark this visit'
                                  : 'Mark as visited without writing up a full observation — you choose which day'
                              }
                            >
                              {e.doneAt ? 'Undo' : 'Done'}
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
