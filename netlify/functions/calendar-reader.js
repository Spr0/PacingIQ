// ---------------------------------------------------------------------------
// AI Pacing Calendar Reader — Netlify Function.
//
// Reads a pasted pacing calendar (the manual-upload path for teachers whose
// district doesn't sync through Google Classroom) and extracts a week-by-week
// breakdown: unit, lesson, standard, and any assessment dates. The model is
// read from process.env.ANTHROPIC_MODEL with no fallback, so a missing config
// fails loudly rather than silently shipping a wrong model.
//
// Output is a DRAFT list. The UI requires the coach to review and approve
// before any pacing entries or assessments are created. Nothing is sent
// anywhere from this function.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an instructional coaching assistant. Read the pacing calendar text
provided (a district scope-and-sequence, unit plan, or syllabus, pasted as plain text) and break
it into a week-by-week list. Use ONLY the facts present in the text. Do not invent weeks, dates,
units, or standards that are not stated or clearly implied. If a date is not given for a week,
estimate it from surrounding dates only if the text provides enough structure to do so reliably;
otherwise leave it null.

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { calendarText, context } = JSON.parse(event.body || '{}');
    if (!calendarText || !calendarText.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'calendarText is required' }) };
    }

    const userMessage = context
      ? `Context: ${context}\n\nPacing calendar text:\n${calendarText}`
      : `Pacing calendar text:\n${calendarText}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Anthropic API error', detail: data?.error?.message || '' }),
      };
    }

    const raw = (data.content || []).map((b) => b.text || '').join('').trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Model returned non-JSON output', detail: raw.slice(0, 200) }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Calendar analysis failed', detail: err.message }),
    };
  }
};
