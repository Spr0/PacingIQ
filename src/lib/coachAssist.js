// ---------------------------------------------------------------------------
// AI Coaching Assistant — client helper.
//
// Builds a factual context block from a teacher rollup and records, calls the
// Netlify Function, and falls back to a locally templated draft when the
// function is unavailable (for example in the plain Vite dev preview, where
// serverless functions do not run). Every result is a draft pending human
// approval; this module never sends or saves anything.
// ---------------------------------------------------------------------------

import { formatDate } from './dates.js';
import { recommendedAction } from './intelligence.js';

export const CONTENT_TYPES = [
  { key: 'summary', label: 'Coaching summary' },
  { key: 'principal_report', label: 'Principal report' },
  { key: 'follow_up_email', label: 'Follow-up email' },
  { key: 'meeting_agenda', label: 'Meeting agenda' },
  { key: 'meeting_notes', label: 'Meeting notes' },
  { key: 'action_item_list', label: 'Action item list' },
  { key: 'action_plan', label: 'Action Plan' },
];

export function labelFor(kind) {
  return CONTENT_TYPES.find((c) => c.key === kind)?.label || kind;
}

function latestCompleted(assessments) {
  return [...assessments].filter((a) => a.avgScore != null).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

// A compact, factual context string the model must stay grounded in.
export function buildContext(rollup, observations, assessments, coachName) {
  const t = rollup.teacher;
  const obs = [...observations].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  const test = latestCompleted(assessments);
  const lines = [];

  lines.push(`Coach name: ${coachName}`);
  lines.push(`Teacher: ${t.name}`);
  lines.push(`Subject: ${t.subject || 'n/a'}; Grade: ${t.gradeLevel || 'n/a'}; Assigned admin: ${t.assignedAdmin || 'n/a'}`);
  lines.push(
    `Pacing status: ${rollup.pacingStatus} (${rollup.daysBehind > 0 ? `${rollup.daysBehind} days behind` : 'on pace'})`
  );
  if (rollup.pacing) {
    lines.push(
      `Current unit/lesson/standard: ${rollup.pacing.currentUnit || 'n/a'} / ${rollup.pacing.currentLesson || 'n/a'} / ${rollup.pacing.currentStandard || 'n/a'}`
    );
    if (rollup.pacing.exceptionReason) lines.push(`Pacing exception logged: ${rollup.pacing.exceptionReason}`);
  }
  lines.push(`Risk score: ${rollup.risk.score} (${rollup.risk.band}). Factors: ${rollup.risk.factors.join('; ') || 'none'}`);
  if (rollup.daysSinceObservation == null) lines.push('Last observation: none on record');
  else lines.push(`Last observation: ${rollup.daysSinceObservation} days ago`);

  if (obs) {
    lines.push(`Most recent observation (${formatDate(obs.date)}):`);
    if (obs.lessonObserved) lines.push(`  Lesson: ${obs.lessonObserved}`);
    if (obs.engagementLevel) lines.push(`  Student engagement: ${obs.engagementLevel}`);
    if (obs.strengths) lines.push(`  Strengths: ${obs.strengths}`);
    if (obs.areasForGrowth) lines.push(`  Areas for growth: ${obs.areasForGrowth}`);
    if (obs.feedbackProvided) lines.push(`  Feedback provided: ${obs.feedbackProvided}`);
  }
  if (test) {
    lines.push(
      `Most recent unit test: ${test.name}, average ${test.avgScore}, proficiency ${test.proficiencyPct ?? 'n/a'}%. Trend: ${rollup.assessmentTrend}.`
    );
  }
  if (rollup.outstandingActions.length) {
    lines.push('Outstanding action items:');
    rollup.outstandingActions.forEach((a) =>
      lines.push(`  - ${a.description} (owner: ${a.owner || 'n/a'}, due: ${a.dueDate ? formatDate(a.dueDate) : 'n/a'}, status: ${a.status})`)
    );
  }
  if (rollup.intervention) {
    const reqs = rollup.intervention.requirements || {};
    const open = Object.entries(reqs).filter(([, v]) => !v).map(([k]) => k);
    lines.push(`Active intervention: ${rollup.intervention.concern} (status: ${rollup.intervention.status}). Open steps: ${open.join(', ') || 'none'}.`);
  }
  lines.push(`System-recommended next support: ${recommendedAction(rollup)}`);

  return lines.join('\n');
}

// Calls the serverless function. On failure it throws an Error whose `reachable`
// flag distinguishes two cases:
//   reachable === false  the function is not deployed / not running (e.g. the
//                        plain vite preview). The caller should fall back to a
//                        local demo draft.
//   reachable === true   the function ran but failed (bad or missing
//                        ANTHROPIC_API_KEY / ANTHROPIC_MODEL, API error). This is
//                        a config error and should be surfaced loudly, not masked.
export async function generateDraft(kind, context, language = 'en') {
  let res;
  try {
    res = await fetch('/.netlify/functions/coach-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, context, language }),
    });
  } catch {
    const err = new Error('Coaching assistant function is not reachable.');
    err.reachable = false;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  // No JSON body (for example the SPA catch-all served index.html) means the
  // function is not deployed here.
  if (!ct.includes('application/json')) {
    const err = new Error('Coaching assistant function is not deployed here.');
    err.reachable = false;
    throw err;
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.detail || data.error || `Request failed (${res.status})`);
    err.reachable = true;
    throw err;
  }
  if (!data.text) {
    const err = new Error('The model returned an empty response.');
    err.reachable = true;
    throw err;
  }
  return data.text;
}

// Locally templated draft used when the function is not reachable. Grounded in
// the same facts so the demo is useful offline.
export function localDraft(kind, rollup, observations, assessments, coachName) {
  const t = rollup.teacher;
  const obs = [...observations].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  const test = latestCompleted(assessments);
  const pacing =
    rollup.daysBehind > 0 ? `${rollup.daysBehind} days behind pace` : 'on pace';
  const clean = (s) => (s || '').trim().replace(/[.;,\s]+$/, '');
  const strength = clean(obs?.strengths) || 'consistent classroom routines';
  const growth = clean(obs?.areasForGrowth) || 'tightening pacing and checks for understanding';
  const next = recommendedAction(rollup);

  switch (kind) {
    case 'summary':
      return `${t.name} (${t.subject}, Grade ${t.gradeLevel}) is currently ${pacing}, with a risk score of ${rollup.risk.score} (${rollup.risk.band}). ${
        rollup.pacing ? `Instruction is in ${rollup.pacing.currentUnit}.` : ''
      } The most recent observation noted strengths in ${strength.toLowerCase()} and a growth focus on ${growth.toLowerCase()}.${
        test ? ` The latest unit test (${test.name}) averaged ${test.avgScore} with ${test.proficiencyPct ?? 'n/a'}% proficiency.` : ''
      }\n\nRecommended next support: ${next}.${
        rollup.outstandingActions.length ? ` There ${rollup.outstandingActions.length === 1 ? 'is' : 'are'} ${rollup.outstandingActions.length} open action item(s) to close.` : ''
      }`;

    case 'principal_report':
      return `Teacher: ${t.name} (${t.subject}, Grade ${t.gradeLevel})\nStatus: ${rollup.pacingStatus} pacing, ${pacing}. Risk ${rollup.risk.score} (${rollup.risk.band}).\nKey concern: ${rollup.risk.factors[0] || 'no significant concern at this time'}.\nSupport provided: ${
        rollup.intervention ? `active intervention (${rollup.intervention.status})` : 'regular observation and coaching cadence'
      }.\nRecommended next step: ${next}.`;

    case 'follow_up_email':
      return `Subject: Follow-up from our recent classroom visit\n\nHi ${t.name.split(' ')[0]},\n\nThank you for welcoming me into your ${t.subject} class. I was glad to see ${strength.toLowerCase()}. As a next focus, let us work together on ${growth.toLowerCase()}.\n\nA concrete next step: ${next}. I will follow up within the next two weeks to see how it is going, and I am happy to co-plan beforehand.\n\nBest,\n${coachName}`;

    case 'meeting_agenda':
      return `Coaching meeting agenda: ${t.name}\n\n1. Pacing check. Currently ${pacing}${rollup.pacing ? ` in ${rollup.pacing.currentUnit}` : ''}.\n2. Recent observation debrief. Strength: ${strength}. Growth: ${growth}.\n3. ${test ? `Assessment review. ${test.name}: ${test.avgScore} average, ${test.proficiencyPct ?? 'n/a'}% proficiency.` : 'Assessment readiness for the next unit test.'}\n4. Action items. ${rollup.outstandingActions.length ? `${rollup.outstandingActions.length} open item(s) to review.` : 'Set one or two focused next steps.'}\n5. Agreed next step: ${next}.\n6. Schedule the next touchpoint.`;

    case 'meeting_notes': {
      const items = rollup.outstandingActions.length
        ? rollup.outstandingActions
            .map((a) => `- ${a.description}${a.owner ? ` (owner: ${a.owner})` : ''}`)
            .join('\n')
        : `- ${next}`;
      return `Coaching meeting notes: ${t.name}\n\nDiscussion:\nReviewed pacing (${pacing}${
        rollup.pacing ? ` in ${rollup.pacing.currentUnit}` : ''
      }) and the recent observation. Strength noted: ${strength}. Growth focus: ${growth}.${
        test ? ` Reviewed ${test.name}: ${test.avgScore} average, ${test.proficiencyPct ?? 'n/a'}% proficiency.` : ''
      }\n\nDecisions:\nAgreed to prioritize ${growth.toLowerCase()} over the next two weeks.\n\nNext steps:\n${items}\nNext support: ${next}.`;
    }

    case 'action_item_list':
      return rollup.outstandingActions.length
        ? `Action items: ${t.name}\n\n` +
            rollup.outstandingActions
              .map(
                (a, i) =>
                  `${i + 1}. ${a.description} (owner: ${a.owner || 'n/a'}, due: ${
                    a.dueDate ? formatDate(a.dueDate) : 'n/a'
                  }, status: ${a.status})`
              )
              .join('\n')
        : `Action items: ${t.name}\n\n1. ${next} (owner: Coach, due: within two weeks, status: Open)`;

    case 'action_plan':
      return `Action plan: ${t.name}\n\nConcern: ${rollup.risk.factors[0] || `${pacing}`}.\nLikely root cause: ${
        rollup.pacing?.exceptionReason ? `recent ${rollup.pacing.exceptionReason.toLowerCase()} and reteach load` : 'pacing pressure with limited in-lesson checks for understanding'
      }.\n\nAgreed actions:\n1. Co-plan a compressed pacing map for the current unit. Owner: Coach.\n2. Embed a formative check every 15 minutes. Owner: ${t.name}.\n3. Follow-up observation focused on engagement. Owner: Coach.\n\nFollow-up checkpoint: review progress within two weeks. Next support: ${next}.`;

    default:
      return next;
  }
}
