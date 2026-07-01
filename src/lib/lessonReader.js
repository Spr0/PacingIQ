// ---------------------------------------------------------------------------
// AI Lesson Plan Reader — client helper.
//
// Calls the Netlify Function to extract unit/lesson/standard/objective/
// assessment references/pacing concerns from a pasted lesson plan, and falls
// back to a locally templated (regex-based) reading when the function is
// unavailable (for example in the plain Vite dev preview). Every result is a
// draft pending human review; this module never saves or applies anything.
// ---------------------------------------------------------------------------

// Calls the serverless function. On failure it throws an Error whose
// `reachable` flag distinguishes two cases, matching the coach-assist client:
//   reachable === false  the function is not deployed / not running.
//   reachable === true   the function ran but failed (config or API error).
export async function analyzeLessonPlan(lessonText, context) {
  let res;
  try {
    res = await fetch('/.netlify/functions/lesson-reader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonText, context }),
    });
  } catch {
    const err = new Error('Lesson plan reader function is not reachable.');
    err.reachable = false;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const err = new Error('Lesson plan reader function is not deployed here.');
    err.reachable = false;
    throw err;
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.detail || data.error || `Request failed (${res.status})`);
    err.reachable = true;
    throw err;
  }
  return data;
}

// Offline demo fallback: a light regex read of common lesson-plan phrasing.
// Clearly a lesser result than the live model, but keeps the flow usable and
// grounded in the pasted text when the function isn't running.
export function localLessonAnalysis(lessonText) {
  const text = lessonText || '';
  const unitMatch = text.match(/unit\s*[:#]?\s*([\w .-]{1,40})/i);
  const lessonMatch = text.match(/lesson\s*[:#]?\s*([\w .-]{1,40})/i);
  const standardMatch = text.match(/standard[s]?[ \t]*[:#]?[ \t]*([A-Z0-9.\-, ]{1,60})/i);
  const objectiveMatch = text.match(/objective[s]?\s*[:]?\s*([^\n.]{1,160})/i);
  const assessmentMatches = [...text.matchAll(/\b(quiz|unit test|assessment|exit ticket)[^\n.]{0,60}/gi)].map(
    (m) => m[0].trim()
  );
  const pacingConcern = /reteach|multi-day|two days|three days|extra time|behind/i.test(text)
    ? 'The lesson text mentions reteaching or extra time, which may affect pacing.'
    : null;

  return {
    unit: unitMatch ? unitMatch[1].trim() : null,
    lesson: lessonMatch ? lessonMatch[1].trim() : null,
    standard: standardMatch ? standardMatch[1].trim() : null,
    objective: objectiveMatch ? objectiveMatch[1].trim() : null,
    assessmentReferences: assessmentMatches.slice(0, 3),
    pacingConcerns: pacingConcern,
    summary: text.length > 0 ? `Demo read of a ${text.length}-character lesson plan.` : 'No lesson plan text provided.',
  };
}
