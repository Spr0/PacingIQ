// ---------------------------------------------------------------------------
// Client-side calendar export for goal target dates. No OAuth or server call
// needed: a Google Calendar / Outlook "add event" link is just a URL with
// query params, and .ics is a plain text file any calendar app can import.
// This is the real, working integration available today; live two-way sync
// (auto-created/updated events via Google Classroom/Outlook) needs OAuth
// credentials this environment doesn't have — see the README fast-follow note.
// ---------------------------------------------------------------------------

import { parse } from './dates.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function icsDate(value) {
  const d = parse(value);
  return d ? `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` : null;
}

// Exclusive end date for an all-day event: the day after the target date.
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
    .replace(/\n/g, '\\n');
}

function eventDetails(goal) {
  return [goal.notes, goal.owner ? `Owner: ${goal.owner}` : null].filter(Boolean).join('\n');
}

// Google Classroom due dates surface on the teacher's Google Calendar, so a
// Google Calendar link doubles as the Classroom-side integration point.
export function googleCalendarUrl(goal) {
  const start = icsDate(goal.targetDate);
  if (!start) return null;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Goal: ${goal.title}`,
    dates: `${start}/${icsDateAfter(goal.targetDate)}`,
    details: eventDetails(goal),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(goal) {
  if (!goal.targetDate) return null;
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `Goal: ${goal.title}`,
    startdt: goal.targetDate,
    enddt: goal.targetDate,
    allday: 'true',
    body: eventDetails(goal),
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// Generic .ics download — works with Apple Calendar or any app that isn't
// Google/Outlook's own web deep link.
export function downloadGoalIcs(goal) {
  const start = icsDate(goal.targetDate);
  if (!start) return;
  const now = new Date();
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PacingIQ//Goals//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:goal-${goal.id}@pacingiq`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${icsDateAfter(goal.targetDate)}`,
    `SUMMARY:${escapeIcsText(`Goal: ${goal.title}`)}`,
    goal.notes ? `DESCRIPTION:${escapeIcsText(goal.notes)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(goal.title || 'goal').replace(/[^\w\- ]/g, '').slice(0, 60) || 'goal'}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
