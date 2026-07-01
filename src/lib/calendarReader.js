// ---------------------------------------------------------------------------
// AI Pacing Calendar Reader — client helper.
//
// Calls the Netlify Function to break a pasted pacing calendar (the manual-
// upload path) into a week-by-week list of units/lessons/standards/assessment
// dates, and falls back to a small locally generated example when the
// function is unavailable (for example in the plain Vite dev preview). Every
// result is a draft pending human review; this module never saves anything.
// ---------------------------------------------------------------------------

import { isoDate } from './dates.js';

// Calls the serverless function. Same reachable/not-reachable error contract
// as the coach-assist and lesson-reader clients.
export async function analyzeCalendar(calendarText, context) {
  let res;
  try {
    res = await fetch('/.netlify/functions/calendar-reader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarText, context }),
    });
  } catch {
    const err = new Error('Pacing calendar reader function is not reachable.');
    err.reachable = false;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const err = new Error('Pacing calendar reader function is not deployed here.');
    err.reachable = false;
    throw err;
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.detail || data.error || `Request failed (${res.status})`);
    err.reachable = true;
    throw err;
  }
  return data.weeks || [];
}

// Offline demo fallback: a naive line-by-line read that looks for "Unit",
// "Lesson", and "Standard" mentions and spreads them across upcoming weeks.
// Clearly a lesser result than the live model; the coach reviews and edits
// every row before anything is imported.
export function localCalendarAnalysis(calendarText) {
  const lines = (calendarText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  return lines.slice(0, 8).map((line, i) => {
    const unitMatch = line.match(/unit\s*[:#]?\s*([\w .-]{1,40})/i);
    const lessonMatch = line.match(/lesson\s*[:#]?\s*([\w .-]{1,40})/i);
    const standardMatch = line.match(/standard[s]?\s*[:#]?\s*([A-Z0-9.\-,\s]{1,40})/i);
    const testMatch = line.match(/\b(unit test|assessment|quiz)[^\n.]{0,40}/i);
    const weekOf = isoDate(new Date(Date.now() + i * 7 * 86400000));
    return {
      weekOf,
      unit: unitMatch ? unitMatch[1].trim() : (i === 0 ? `Demo read, line ${i + 1}` : null),
      lesson: lessonMatch ? lessonMatch[1].trim() : null,
      standard: standardMatch ? standardMatch[1].trim() : null,
      assessmentName: testMatch ? testMatch[0].trim() : null,
      assessmentDate: testMatch ? weekOf : null,
    };
  });
}
