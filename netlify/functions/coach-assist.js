// ---------------------------------------------------------------------------
// AI Coaching Assistant — Netlify Function.
//
// Generates coaching content (summary, principal report, follow-up email,
// meeting agenda, action-plan recommendation) from facts supplied by the
// client. The model is read from process.env.ANTHROPIC_MODEL with no fallback,
// so a missing config fails loudly rather than silently shipping a wrong model.
//
// All generated content is a DRAFT. The UI requires human approval before it is
// saved. Nothing is sent anywhere from this function.
// ---------------------------------------------------------------------------

const SHARED_STYLE = `
Write in a direct, professionally warm tone. Be specific and concrete.
Use ONLY the facts provided in the context. Do not invent metrics, dates, events,
or quotes. If a fact is missing, omit it rather than guessing.
Do not use em dashes. Do not use filler qualifiers like "successfully" or
"seamlessly". Avoid first-person pronouns except in the follow-up email, which is
written from the coach to the teacher.`;

const SYSTEM_PROMPTS = {
  summary: `You are an instructional coaching assistant. Write a concise coaching summary
for the coach's private records, covering the teacher's current pacing, recent
observation, assessment signal, and any open support. Two short paragraphs.${SHARED_STYLE}`,

  principal_report: `You are an instructional coaching assistant. Write a brief principal-facing
status report on this teacher: current status, the key concern, support provided
to date, and the recommended next step. Four to six sentences, objective.${SHARED_STYLE}`,

  follow_up_email: `You are an instructional coaching assistant. Draft a follow-up email from the
coach to the teacher after a recent observation or coaching touchpoint. Open with
a specific strength, name one growth focus, and propose one concrete next step with
a timeframe. Sign as the coach using the name provided. Output the email body only,
including a subject line on the first line.${SHARED_STYLE}`,

  meeting_agenda: `You are an instructional coaching assistant. Create a focused coaching meeting
agenda of four to six items with a short note under each, based on the teacher's
current pacing, assessment signal, and open action items. Use a numbered list.${SHARED_STYLE}`,

  action_plan: `You are an instructional coaching assistant. Recommend a short intervention action
plan: the concern, the most likely root cause, three agreed actions each with an
owner, and a follow-up checkpoint. Use clear headings.${SHARED_STYLE}`,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { kind, context } = JSON.parse(event.body || '{}');
    const system = SYSTEM_PROMPTS[kind];
    if (!system) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown kind: ${kind}` }) };
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
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: context }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Anthropic API error', detail: data?.error?.message || '' }),
      };
    }

    const text = (data.content || []).map((b) => b.text || '').join('').trim();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Generation failed', detail: err.message }),
    };
  }
};
