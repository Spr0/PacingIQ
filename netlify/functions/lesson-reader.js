// ---------------------------------------------------------------------------
// AI Lesson Plan Reader — Netlify Function.
//
// Reads a lesson plan (pasted text) and extracts the unit, lesson, standard,
// objective, assessment references, and any pacing concerns. The model is
// read from process.env.ANTHROPIC_MODEL with no fallback, so a missing config
// fails loudly rather than silently shipping a wrong model.
//
// Output is a DRAFT. The UI requires human review before anything is applied
// to a teacher's pacing record. Nothing is sent anywhere from this function.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an instructional coaching assistant. Read the lesson plan text provided
and extract what it covers. Use ONLY the facts present in the lesson plan text. Do not invent
units, standards, or dates that are not stated or clearly implied.

Return ONLY valid JSON, no markdown fences, no prose, matching exactly this shape:
{
  "unit": "<unit name/number, or null if not stated>",
  "lesson": "<lesson name/number, or null if not stated>",
  "standard": "<standard code(s), or null if not stated>",
  "objective": "<the lesson objective in one sentence, or null if not stated>",
  "assessmentReferences": ["<any assessment, quiz, or unit test the plan references>"],
  "pacingConcerns": "<one sentence on anything suggesting the class may fall behind pace (e.g. reteach built in, multi-day lesson, heavy content load), or null if none>",
  "summary": "<one sentence summary of the lesson>"
}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { lessonText, context } = JSON.parse(event.body || '{}');
    if (!lessonText || !lessonText.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'lessonText is required' }) };
    }

    const userMessage = context
      ? `Context: ${context}\n\nLesson plan text:\n${lessonText}`
      : `Lesson plan text:\n${lessonText}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL,
        max_tokens: 800,
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
      body: JSON.stringify({ error: 'Lesson plan analysis failed', detail: err.message }),
    };
  }
};
