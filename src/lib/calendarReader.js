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

// A full-year calendar with prose unit descriptions can take longer than the
// serverless function's timeout to read in one shot (a 504). So large text is
// split into line-aligned batches, each read in its own call, and the weeks are
// merged. A short first line (title or CSV header) is repeated on every batch so
// each keeps its column context.
const MAX_CHARS_PER_CALL = 3000;
const MAX_CONCURRENT_CALLS = 3;

function chunkCalendar(text, maxChars) {
  if (!text || text.length <= maxChars) return [text || ''];
  const lines = text.split('\n');
  const header = lines.length > 1 && lines[0].length <= 300 ? lines[0] : '';
  const body = header ? lines.slice(1) : lines;
  const budget = Math.max(500, maxChars - (header ? header.length + 1 : 0));
  const chunks = [];
  let cur = '';
  for (const line of body) {
    if (cur && cur.length + line.length + 1 > budget) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => (header ? `${header}\n${c}` : c));
}

// Runs an async mapper over items with bounded concurrency, preserving order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// One call to the serverless function. Same reachable/not-reachable error
// contract as the coach-assist and lesson-reader clients.
async function callCalendarReader(payload) {
  let res;
  try {
    res = await fetch('/.netlify/functions/calendar-reader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    const err = new Error('Pacing calendar reader function is not reachable.');
    err.reachable = false;
    throw err;
  }

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* not JSON */
  }

  if (res.ok && data) return data.weeks || [];

  // A 2xx non-JSON body is the SPA catch-all serving index.html: the function
  // is not running here (e.g. plain vite dev). Fall back to the offline demo.
  if (res.ok) {
    const err = new Error('Pacing calendar reader function is not deployed here.');
    err.reachable = false;
    throw err;
  }

  // Any error status means the function IS deployed but failed (config error,
  // timeout, truncated output). Surface it instead of masking it as offline.
  const err = new Error((data && (data.detail || data.error)) || `Request failed (${res.status})`);
  err.reachable = true;
  throw err;
}

// `document` is an optional { fileBase64, mediaType } for the PDF-upload path;
// when present the function hands it to the model as a native document block.
export async function analyzeCalendar(calendarText, context, document) {
  if (document && document.fileBase64) {
    return callCalendarReader({ context, document });
  }
  const chunks = chunkCalendar(calendarText || '', MAX_CHARS_PER_CALL);
  if (chunks.length <= 1) {
    return callCalendarReader({ calendarText: chunks[0], context });
  }
  const perChunk = await mapLimit(chunks, MAX_CONCURRENT_CALLS, (chunk) =>
    callCalendarReader({ calendarText: chunk, context })
  );
  return perChunk.flat();
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
