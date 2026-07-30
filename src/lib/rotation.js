// ---------------------------------------------------------------------------
// Observation rotation: generating a cycle, and reading a stored one back.
//
// Shared by the Schedule page and the dashboard card so the two can't drift
// apart on what "this week" or "done" means.
//
// A cycle is 10 school days (two weeks), matching SEEN_WINDOW_DAYS = 14 in
// intelligence.js -- the compliance window every teacher has to be seen
// inside. The roster is spread evenly across all 10 days rather than packed
// at a fixed 8/day: with 48 teachers, packing finishes in 6 days and leaves
// 4 dead ones, whereas spreading gives ~5 classrooms a day, every day.
// PER_DAY_CAP is therefore a ceiling, not a quota.
// ---------------------------------------------------------------------------

import { today, parse, isoDate } from './dates.js';

export const CYCLE_WEEKDAYS = 10; // two school weeks
export const PER_DAY_CAP = 8; // most visits we'd ask of one day

export function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

export function nextWeekday(d) {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  while (!isWeekday(next)) next.setDate(next.getDate() + 1);
  return next;
}

export function snapToWeekday(d) {
  return isWeekday(d) ? d : nextWeekday(d);
}

// Fisher-Yates. Math.random is fine here: this decides visit order, not
// anything that needs to be unpredictable to an adversary.
export function shuffled(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Splits `total` items across `buckets` as evenly as possible, biggest first:
// 48 over 10 -> [5,5,5,5,5,5,5,5,4,4]. Returns per-bucket counts.
export function evenSplit(total, buckets) {
  if (buckets <= 0 || total <= 0) return [];
  const base = Math.floor(total / buckets);
  const extra = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < extra ? 1 : 0));
}

// Builds the schedule_entries rows for one cycle: every teacher exactly once,
// spread across up to CYCLE_WEEKDAYS weekdays starting at `startDate`.
//
// A roster too big for one cycle at PER_DAY_CAP spills into further cycles
// (continuing on consecutive weekdays) rather than overloading a day.
export function buildCycleEntries(teachers, startDate) {
  const roster = shuffled(teachers);
  if (!roster.length) return [];

  // Spread over a full cycle. A roster too big to fit one cycle at the daily
  // cap (more than 10 x 8 = 80 teachers) extends into further cycles rather
  // than overloading any single day.
  const cyclesNeeded = Math.max(1, Math.ceil(roster.length / (CYCLE_WEEKDAYS * PER_DAY_CAP)));
  const counts = evenSplit(roster.length, cyclesNeeded * CYCLE_WEEKDAYS);

  const entries = [];
  let cursor = snapToWeekday(parse(startDate) || today());
  let i = 0;
  for (const count of counts) {
    const dateStr = isoDate(cursor);
    for (let k = 0; k < count; k += 1) {
      entries.push({ teacherId: roster[i].id, scheduledDate: dateStr });
      i += 1;
    }
    cursor = nextWeekday(cursor);
  }
  return entries;
}

// A scheduled visit counts as done when it was ticked off by hand OR an
// observation exists for that teacher on that date. Deriving the second half
// means writing up an observation ticks the box with no extra step.
export function isEntryDone(entry, observations) {
  if (entry.doneAt) return true;
  return observations.some((o) => o.teacherId === entry.teacherId && o.date === entry.scheduledDate);
}

// Groups stored entries into days, then days into cycles of CYCLE_WEEKDAYS.
// Derived from the dates themselves so a reload sees the same shape a fresh
// generate produced.
export function groupSchedule(scheduleEntries, teachers, observations = []) {
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const byDate = new Map();
  scheduleEntries.forEach((e) => {
    if (!byDate.has(e.scheduledDate)) byDate.set(e.scheduledDate, []);
    byDate.get(e.scheduledDate).push(e);
  });

  const days = Array.from(byDate.keys())
    .sort()
    .map((date) => {
      const entries = byDate
        .get(date)
        .map((e) => ({
          ...e,
          teacher: teacherById.get(e.teacherId),
          done: isEntryDone(e, observations),
        }))
        // Guards a since-deleted teacher's row until the next regenerate.
        .filter((e) => e.teacher)
        .sort((a, b) => (a.teacher.name || '').localeCompare(b.teacher.name || ''));
      return { date, entries, doneCount: entries.filter((e) => e.done).length };
    })
    // A date whose every entry pointed at a deleted teacher has nothing left
    // to show; dropping it here stops the UI rendering a bare day header with
    // no rows under it. Cycle numbering is assigned after this so it stays
    // contiguous.
    .filter((d) => d.entries.length > 0)
    .map((d, i) => ({ ...d, cycle: Math.floor(i / CYCLE_WEEKDAYS) + 1 }));

  const cycles = new Map();
  days.forEach((d) => {
    if (!cycles.has(d.cycle)) cycles.set(d.cycle, []);
    cycles.get(d.cycle).push(d);
  });

  return {
    days,
    cycles: Array.from(cycles.entries()).map(([cycle, ds]) => ({ cycle, days: ds })),
  };
}

// The days a coach cares about right now: today (if scheduled) plus the rest
// of this working week. Used by the dashboard card.
export function thisWeek(days) {
  const t = today();
  const todayStr = isoDate(t);
  // End of the current Mon-Fri week.
  const endOfWeek = new Date(t);
  const dow = t.getDay(); // 0 Sun .. 6 Sat
  const daysToFriday = dow === 0 ? 5 : 5 - dow;
  endOfWeek.setDate(endOfWeek.getDate() + Math.max(0, daysToFriday));
  const endStr = isoDate(endOfWeek);

  return {
    today: days.find((d) => d.date === todayStr) || null,
    rest: days.filter((d) => d.date > todayStr && d.date <= endStr),
    upcoming: days.filter((d) => d.date > todayStr),
  };
}

// True when every scheduled day is in the past, i.e. the rotation has run
// its course and the next cycle is due.
export function cycleHasEnded(days) {
  if (!days.length) return false;
  return days[days.length - 1].date < isoDate(today());
}
