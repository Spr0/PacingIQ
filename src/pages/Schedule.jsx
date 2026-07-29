// ---------------------------------------------------------------------------
// Observation rotation randomizer. Randomly assigns every teacher one visit
// day, 8 teachers per school day, across 2-week (10 weekday) cycles -- enough
// per cycle to get everyone seen inside the 14-day compliance window
// (SEEN_WINDOW_DAYS in lib/intelligence.js). A roster bigger than 80 spills
// into a second cycle automatically; "Randomize again" reshuffles everyone
// and starts a fresh rotation. The coach role can generate/clear; every
// other role sees a read-only view.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { today, parse, isoDate } from '../lib/dates.js';
import { Card, Empty } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

const PER_DAY = 8;
const CYCLE_WEEKDAYS = 10; // 2 school weeks -- the 14-day seen-compliance window

function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function nextWeekday(d) {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  while (!isWeekday(next)) next.setDate(next.getDate() + 1);
  return next;
}

function snapToWeekday(d) {
  return isWeekday(d) ? d : nextWeekday(d);
}

function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weekdayLabel(dateStr) {
  const d = parse(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Schedule() {
  const { teachers, scheduleEntries, db, roleKey } = useApp();
  const writable = can(roleKey, 'write');

  const [startDate, setStartDate] = useState(() => isoDate(snapToWeekday(today())));
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

  async function generate() {
    if (!teachers.length || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const roster = shuffled(teachers);
      const entries = [];
      let cursor = snapToWeekday(parse(startDate) || today());
      for (let i = 0; i < roster.length; i += PER_DAY) {
        const dateStr = isoDate(cursor);
        roster.slice(i, i + PER_DAY).forEach((t) => entries.push({ teacherId: t.id, scheduledDate: dateStr }));
        cursor = nextWeekday(cursor);
      }
      await db.replaceSchedule(entries, 'generated observation schedule');
    } catch (err) {
      setGenError(err.message || 'Failed to generate the schedule. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function clearSchedule() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      await db.replaceSchedule([], 'cleared observation schedule');
    } catch (err) {
      setGenError(err.message || 'Failed to clear the schedule. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  // Group persisted entries by date, then chunk consecutive scheduled
  // weekdays into cycles of CYCLE_WEEKDAYS for display -- derived from the
  // dates themselves so a reload sees the same grouping as a fresh generate.
  const cycles = useMemo(() => {
    const byDate = new Map();
    scheduleEntries.forEach((e) => {
      if (!byDate.has(e.scheduledDate)) byDate.set(e.scheduledDate, []);
      byDate.get(e.scheduledDate).push(e);
    });
    const teacherById = new Map(teachers.map((t) => [t.id, t]));
    const days = Array.from(byDate.keys())
      .sort()
      .map((date, i) => ({
        date,
        cycle: Math.floor(i / CYCLE_WEEKDAYS) + 1,
        entries: byDate
          .get(date)
          .map((e) => ({ ...e, teacher: teacherById.get(e.teacherId) }))
          .filter((e) => e.teacher) // guards against a since-deleted teacher's row until the next refresh
          .sort((a, b) => (a.teacher.name || '').localeCompare(b.teacher.name || '')),
      }));
    const map = new Map();
    days.forEach((d) => {
      if (!map.has(d.cycle)) map.set(d.cycle, []);
      map.get(d.cycle).push(d);
    });
    return Array.from(map.entries()).map(([cycle, ds]) => ({ cycle, days: ds }));
  }, [scheduleEntries, teachers]);

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
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
            {teachers.length} teacher{teachers.length === 1 ? '' : 's'} · {PER_DAY} per day · {CYCLE_WEEKDAYS} school days per rotation, then repeats
          </span>
        </div>
        {writable ? (
          <div className="row" style={{ gap: 8 }}>
            {scheduleEntries.length > 0 && (
              <button className="btn btn--ghost" onClick={clearSchedule} disabled={generating}>
                Clear schedule
              </button>
            )}
            <button className="btn btn--primary" onClick={generate} disabled={generating || teachers.length === 0}>
              <Icon name="shuffle" /> {generating ? 'Randomizing…' : scheduleEntries.length ? 'Randomize again' : 'Randomize schedule'}
            </button>
          </div>
        ) : (
          <span className="muted small">View only. Editing is limited to the coach role.</span>
        )}
      </div>

      {genError && <div className="banner banner--danger">{genError}</div>}

      {teachers.length === 0 ? (
        <Card>
          <Empty icon="🎲">Add teachers before generating an observation schedule.</Empty>
        </Card>
      ) : cycles.length === 0 ? (
        <Card>
          <Empty icon="🎲">
            No schedule yet.{writable ? ' Click "Randomize schedule" to assign every teacher a visit day.' : ''}
          </Empty>
        </Card>
      ) : (
        cycles.map(({ cycle, days }) => (
          <Card
            key={cycle}
            title={`Cycle ${cycle}`}
            count={days.reduce((n, d) => n + d.entries.length, 0)}
            action={
              <span className="small muted">
                {weekdayLabel(days[0].date)} – {weekdayLabel(days[days.length - 1].date)}
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
                </tr>
              </thead>
              <tbody>
                {days.flatMap((d) => [
                  <tr key={`${d.date}-head`}>
                    <td colSpan={3} className="schedule-daybar">
                      {weekdayLabel(d.date)} <span className="muted" style={{ fontWeight: 'var(--fw-medium)' }}>· {d.entries.length} of {PER_DAY}</span>
                    </td>
                  </tr>,
                  ...(d.entries.length === 0
                    ? [
                        <tr key={`${d.date}-empty`}>
                          <td colSpan={3} className="muted small">
                            No teachers assigned this day.
                          </td>
                        </tr>,
                      ]
                    : d.entries.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <Link className="tname" to={`/teachers/${e.teacher.id}`}>
                              {e.teacher.name}
                            </Link>
                          </td>
                          <td>{e.teacher.subject || '—'}</td>
                          <td>{e.teacher.gradeLevel || '—'}</td>
                        </tr>
                      ))),
                ])}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
