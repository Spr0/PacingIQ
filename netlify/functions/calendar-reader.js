// ---------------------------------------------------------------------------
// AI Pacing Calendar Reader — Netlify Function.
//
// Reads a pacing calendar (the manual-upload path for teachers whose district
// doesn't sync through Google Classroom) supplied as pasted/extracted text or
// an attached PDF, and extracts a week-by-week breakdown: unit, lesson,
// standard, and any assessment dates. The model is
// read from process.env.ANTHROPIC_MODEL with no fallback, so a missing config
// fails loudly rather than silently shipping a wrong model.
//
// Output is a DRAFT list. The UI requires the coach to review and approve
// before any pacing entries or assessments are created. Nothing is sent
// anywhere from this function.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an instructional coaching assistant. Read the pacing calendar provided
(a district scope-and-sequence, unit plan, or syllabus, supplied as pasted plain text or an
attached PDF document) and break it into a week-by-week list. Use ONLY the facts present in the
source. Do not invent weeks, dates, units, or standards that are not stated or clearly implied. If
a date is not given for a week, estimate it from surrounding dates only if the source provides
enough structure to do so reliably; otherwise leave it null.

Return ONLY valid JSON, no markdown fences, no prose, matching exactly this shape:
{
  "weeks": [
    {
      "weekOf": "<ISO date YYYY-MM-DD if determinable, else null>",
      "unit": "<unit name/number, or null>",
      "lesson": "<lesson name/number, or null>",
      "standard": "<standard code(s), or null>",
      "assessmentName": "<name of a unit test/assessment landing this week, or null>",
      "assessmentDate": "<ISO date YYYY-MM-DD for that assessment, or null>"
    }
  ]
}`;

// Every response carries an application/json content type, including errors, so
// the client can tell a real function error apart from the SPA catch-all (which
// serves HTML) and never masks a failure as an offline demo read.
const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const { calendarText, context, document } = JSON.parse(event.body || '{}');
    const hasText = calendarText && calendarText.trim();
    if (!hasText && !(document && document.fileBase64)) {
      return json(400, { error: 'calendarText or document is required' });
    }

    // PDF-upload path: hand the document to the model as a native block. Text
    // path: pass the pasted/extracted calendar as a plain string.
    let userContent;
    if (document && document.fileBase64) {
      userContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: document.mediaType || 'application/pdf', data: document.fileBase64 },
        },
        {
          type: 'text',
          text: `${context ? `Context: ${context}\n\n` : ''}The attached document is a pacing calendar. Extract the week-by-week breakdown as specified.`,
        },
      ];
    } else {
      userContent = context
        ? `Context: ${context}\n\nPacing calendar text:\n${calendarText}`
        : `Pacing calendar text:\n${calendarText}`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL,
        // Generous ceiling: a full-year calendar is a large JSON table, and a
        // low limit truncates it into invalid JSON. Generation stops when the
        // JSON is complete, so this does not slow smaller calendars.
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return json(response.status, { error: 'Anthropic API error', detail: data?.error?.message || '' });
    }

    const raw = (data.content || []).map((b) => b.text || '').join('').trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(502, { error: 'Model returned non-JSON output', detail: raw.slice(0, 200) });
    }

    return json(200, parsed);
  } catch (err) {
    return json(500, { error: 'Calendar analysis failed', detail: err.message });
  }
};
