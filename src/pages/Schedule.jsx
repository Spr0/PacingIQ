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

  async function toggleDone(entry) {
    if (busy) return;
    // An entry that's done only because an observation exists has nothing to
    // un-tick -- the observation is the record. Only the manual flag toggles.
    const patch = entry.doneAt
      ? { doneAt: null, doneBy: null }
      : { doneAt: new Date().toISOString(), doneBy: user.name };
    try {
      await db.update(
        'scheduleEntries',
        entry.id,
        patch,
        entry.doneAt ? 'un-marked a scheduled visit' : 'marked a scheduled visit done'
      );
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
              <button className="btn btn--sm" onClick={() => downloadScheduleIcs(days)}>
                <Icon name="pacing" /> Calendar
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
            <button
              className="btn btn--primary btn--sm"
              onClick={() => generate(startDate)}
              disabled={busy || teachers.length === 0}
            >
              <Icon name="shuffle" />{' '}
              {busy ? 'Randomizing…' : totalVisits ? 'Randomize again' : 'Randomize schedule'}
            </button>
          ) : (
            <span className="muted small">View only. Editing is limited to the coach role.</span>
          )}
        </div>
      </div>

      {error && <div className="banner banner--danger no-print">{error}</div>}

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
                          <button
                            className="btn btn--ghost btn--sm no-print"
                            style={{ marginLeft: 6 }}
                            onClick={() => toggleDone(e)}
                            title={
                              e.doneAt
                                ? 'Un-mark this visit'
                                : "Mark as visited without writing up a full observation"
                            }
                          >
                            {e.doneAt ? 'Undo' : 'Done'}
                          </button>
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
