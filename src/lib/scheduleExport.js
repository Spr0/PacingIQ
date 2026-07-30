// ---------------------------------------------------------------------------
// Export for the observation rotation (see src/pages/Schedule.jsx).
//
// Calendar export is a downloadable .ics rather than a Google/Outlook "add
// event" deep link: those links carry one event each, and a rotation is
// dozens of visits, so deep-linking would mean dozens of clicks. A single
// .ics imports into Outlook (the district's mail client), Google Calendar,
// and Apple Calendar alike.
//
// One all-day event per DAY, with that day's teachers in the description --
// not one event per teacher. Eight all-day banners stacked on every weekday
// would bury the coach's actual meetings, while one entry per day reads at a
// glance. There is no period or bell-schedule data in the model, so timed
// events aren't possible without inventing times.
// ---------------------------------------------------------------------------

import { parse } from './dates.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function icsDate(value) {
  const d = parse(value);
  return d ? `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` : null;
}

// All-day events use an exclusive end date: the day after.
function icsDateAfter(value) {
  const d = parse(value);
  if (!d) return null;
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function escapeIcsText(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 caps a content line at 75 octets and continues it with CRLF + a
// single space. Outlook is lenient about long lines, but a day's worth of
// teacher names comfortably exceeds the limit and some importers do enforce
// it, so fold properly rather than hoping.
function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

function stamp() {
  const now = new Date();
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

function teacherLine(entry) {
  const t = entry.teacher || {};
  return [t.name, t.subject, t.gradeLevel].filter(Boolean).join(' — ');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// `days` is [{ date: 'YYYY-MM-DD', entries: [{ teacher }] }, ...]
export function buildScheduleIcs(days) {
  const dtstamp = stamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PacingIQ//Observation Rotation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  days.forEach((day) => {
    const start = icsDate(day.date);
    if (!start || !day.entries.length) return;
    const names = day.entries.map(teacherLine).filter(Boolean);
    lines.push(
      'BEGIN:VEVENT',
      // Stable per date, so re-importing an unchanged day updates rather than
      // duplicating it in the calendar.
      `UID:pacingiq-rotation-${start}@pacingiq`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${icsDateAfter(day.date)}`,
      `SUMMARY:${escapeIcsText(`PacingIQ: ${day.entries.length} observation${day.entries.length === 1 ? '' : 's'}`)}`,
      `DESCRIPTION:${escapeIcsText(`Scheduled classroom visits:\n\n${names.join('\n')}`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n');
}

export function downloadScheduleIcs(days, filename = 'pacingiq-observation-rotation.ics') {
  const ics = buildScheduleIcs(days);
  download(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), filename);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildScheduleCsv(days) {
  const rows = [['Date', 'Day', 'Teacher', 'Subject', 'Grade', 'Status']];
  days.forEach((day) => {
    const d = parse(day.date);
    const weekday = d ? d.toLocaleDateString('en-US', { weekday: 'long' }) : '';
    day.entries.forEach((e) => {
      const t = e.teacher || {};
      rows.push([day.date, weekday, t.name || '', t.subject || '', t.gradeLevel || '', e.done ? 'Observed' : 'Scheduled']);
    });
  });
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadScheduleCsv(days, filename = 'pacingiq-observation-rotation.csv') {
  // The BOM makes Excel open a UTF-8 CSV with accented names intact instead
  // of mojibake, which is the difference between this being usable and not.
  const csv = `﻿${buildScheduleCsv(days)}`;
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}
