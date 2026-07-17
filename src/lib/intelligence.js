// ---------------------------------------------------------------------------
// Derived intelligence: pacing status, risk score, and the per-teacher rollup
// that drives the dashboard and the Coaching Impact Report.
//
// All inputs are the raw collections from the store. Nothing here writes state.
// ---------------------------------------------------------------------------

import { daysSince, daysUntil } from './dates.js';

// Pacing thresholds straight from the spec.
//   Green  : on pace (0 days behind)
//   Yellow : 1-3 days behind
//   Red    : more than 3 days behind
export function pacingStatus(daysBehind) {
  const d = Number(daysBehind) || 0;
  if (d <= 0) return 'green';
  if (d <= 3) return 'yellow';
  return 'red';
}

export const SEEN_WINDOW_DAYS = 14; // compliance window from the spec

// Most recent pacing entry for a teacher (by weekOf).
export function latestPacing(teacherId, pacingEntries) {
  return pacingEntries
    .filter((p) => p.teacherId === teacherId)
    .sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1))[0] || null;
}

// Elementary (and any multi-subject) teachers log pacing per subject. Each
// pacing entry may carry an optional `subject` field; entries without one are
// grouped together under a single implicit subject, so single-subject
// teachers behave exactly as before. Returns the latest entry per subject,
// sorted by subject name.
export function pacingEntriesBySubject(teacherId, pacingEntries) {
  const mine = pacingEntries.filter((p) => p.teacherId === teacherId);
  const groups = new Map();
  mine.forEach((p) => {
    const key = p.subject || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return Array.from(groups.entries())
    .map(([subject, entries]) => {
      const latest = entries.sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1))[0];
      const daysBehind = Number(latest.daysBehind) || 0;
      return { subject, pacing: latest, daysBehind, status: pacingStatus(daysBehind) };
    })
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
}

// "1" -> "1st Grade", "K" -> "Kindergarten", etc. Used to label per-subject
// pacing rows for multi-subject (typically elementary) teachers.
export function gradeLabel(gradeLevel) {
  if (gradeLevel == null || gradeLevel === '') return null;
  const g = String(gradeLevel).trim();
  if (/^k(indergarten)?$/i.test(g)) return 'Kindergarten';
  const n = Number(g);
  if (!Number.isFinite(n)) return `Grade ${g}`;
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix} Grade`;
}

// Most recent observation for a teacher (by date).
export function latestObservation(teacherId, observations) {
  return observations
    .filter((o) => o.teacherId === teacherId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

// Unit-test assessments for a teacher, newest first.
export function teacherAssessments(teacherId, assessments) {
  return assessments
    .filter((a) => a.teacherId === teacherId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function activeIntervention(teacherId, interventions) {
  return interventions.find(
    (i) => i.teacherId === teacherId && i.status !== 'Complete'
  ) || null;
}

// Collect outstanding (not complete) action items for a teacher across
// observations, interventions, and goals.
export function outstandingActions(teacherId, observations, interventions, goals = []) {
  const items = [];
  observations
    .filter((o) => o.teacherId === teacherId)
    .forEach((o) =>
      (o.actionItems || []).forEach((ai) => {
        if (ai.status !== 'Complete') {
          items.push({ ...ai, source: 'Observation', sourceId: o.id });
        }
      })
    );
  interventions
    .filter((i) => i.teacherId === teacherId)
    .forEach((iv) =>
      (iv.agreedActions || []).forEach((ai) => {
        if (ai.status !== 'Complete') {
          items.push({ ...ai, source: 'Intervention', sourceId: iv.id });
        }
      })
    );
  // A goal is a single target rather than a list of steps, so it maps
  // straight onto the shared action-item shape (description/owner/dueDate)
  // instead of iterating a nested collection like the two blocks above.
  goals
    .filter((g) => g.teacherId === teacherId)
    .forEach((g) => {
      if (g.status !== 'Complete') {
        items.push({
          id: g.id,
          description: g.title,
          owner: g.owner,
          dueDate: g.targetDate,
          status: g.status,
          source: 'Goal',
          sourceId: g.id,
        });
      }
    });
  return items;
}

export function isOverdue(action) {
  if (!action || !action.dueDate || action.status === 'Complete') return false;
  const d = daysUntil(action.dueDate);
  return d != null && d < 0;
}

// Assessment trend: compare two most recent unit tests.
export function assessmentTrend(list) {
  if (list.length < 2) return 'flat';
  const [newest, prev] = list;
  const delta = (newest.avgScore || 0) - (prev.avgScore || 0);
  if (delta >= 2) return 'up';
  if (delta <= -2) return 'down';
  return 'flat';
}

export function assessmentConcern(list) {
  if (!list.length) return false;
  const newest = list[0];
  if ((newest.proficiencyPct ?? 100) < 70) return true;
  return assessmentTrend(list) === 'down';
}

// ---------------------------------------------------------------------------
// Risk score: a 0-100 number plus a green/yellow/red band. Higher = more risk.
// Deterministic and explainable so the demo can show *why* a teacher is at risk.
// ---------------------------------------------------------------------------
export function riskScore(rollupInputs) {
  const { pacing, daysSinceObservation, overdueCount, assessmentFlag, hasOpenIntervention } =
    rollupInputs;

  let score = 0;
  const factors = [];

  const behind = pacing ? Number(pacing.daysBehind) || 0 : 0;
  if (behind > 3) {
    score += 40;
    factors.push(`More than 3 days behind pace (${behind})`);
  } else if (behind >= 1) {
    score += 20;
    factors.push(`${behind} day(s) behind pace`);
  }

  if (daysSinceObservation == null) {
    score += 20;
    factors.push('Never observed');
  } else if (daysSinceObservation > SEEN_WINDOW_DAYS) {
    score += 20;
    factors.push(`Not observed in ${daysSinceObservation} days`);
  } else if (daysSinceObservation > 10) {
    score += 10;
    factors.push(`Last observed ${daysSinceObservation} days ago`);
  }

  if (overdueCount > 0) {
    score += Math.min(20, overdueCount * 10);
    factors.push(`${overdueCount} overdue action item(s)`);
  }

  if (assessmentFlag) {
    score += 15;
    factors.push('Assessment concern (low proficiency or downward trend)');
  }

  if (hasOpenIntervention) {
    score += 10;
    factors.push('Active intervention in progress');
  }

  score = Math.min(100, score);
  let band = 'green';
  if (score >= 50) band = 'red';
  else if (score >= 25) band = 'yellow';

  return { score, band, factors };
}

// ---------------------------------------------------------------------------
// The master rollup. One object per teacher with everything the dashboard,
// teacher detail view, and Coaching Impact Report need.
// ---------------------------------------------------------------------------
export function buildRollup(teacher, collections) {
  const { observations, pacingEntries, assessments, interventions, goals } = collections;

  // Per-subject breakdown first. For a single-subject teacher this collapses
  // to one group, so `pacing`/`daysBehind` below match prior behavior exactly.
  const subjectPacing = pacingEntriesBySubject(teacher.id, pacingEntries).map((sp) => ({
    ...sp,
    label: sp.subject ? [gradeLabel(teacher.gradeLevel), sp.subject].filter(Boolean).join(' ') : null,
  }));
  const multiSubject = subjectPacing.length > 1;
  // The worst (most behind) subject drives the aggregate pacing fields used by
  // the risk score and every list/table that isn't subject-aware.
  const worstSubject = subjectPacing.length
    ? subjectPacing.reduce((a, b) => (b.daysBehind > a.daysBehind ? b : a))
    : null;
  const pacing = worstSubject ? worstSubject.pacing : null;

  const lastObs = latestObservation(teacher.id, observations);
  const assessList = teacherAssessments(teacher.id, assessments);
  const intervention = activeIntervention(teacher.id, interventions);
  const actions = outstandingActions(teacher.id, observations, interventions, goals);
  const overdue = actions.filter(isOverdue);

  const dsObs = lastObs ? daysSince(lastObs.date) : null;
  const assessFlag = assessmentConcern(assessList);

  const risk = riskScore({
    pacing,
    daysSinceObservation: dsObs,
    overdueCount: overdue.length,
    assessmentFlag: assessFlag,
    hasOpenIntervention: !!intervention,
  });

  const daysBehind = pacing ? Number(pacing.daysBehind) || 0 : 0;

  return {
    teacher,
    pacing,
    pacingBySubject: subjectPacing,
    multiSubject,
    pacingStatus: pacingStatus(daysBehind),
    daysBehind,
    lastObservation: lastObs,
    daysSinceObservation: dsObs,
    seenCompliant: dsObs != null && dsObs <= SEEN_WINDOW_DAYS,
    assessments: assessList,
    latestAssessment: assessList[0] || null,
    assessmentTrend: assessmentTrend(assessList),
    assessmentConcern: assessFlag,
    intervention,
    outstandingActions: actions,
    overdueActions: overdue,
    risk,
  };
}

export function buildAllRollups(teachers, collections) {
  return teachers.map((t) => buildRollup(t, collections));
}

// Intelligent next-action recommendation used by the dashboard and report.
export function recommendedAction(rollup) {
  if (rollup.intervention && rollup.intervention.status !== 'Complete') {
    return 'Advance the open intervention plan and complete follow-up observation';
  }
  if (rollup.pacingStatus === 'red') {
    return 'Open an intervention case, more than 3 days behind pace';
  }
  if (rollup.overdueActions.length > 0) {
    return `Close ${rollup.overdueActions.length} overdue action item(s)`;
  }
  if (rollup.daysSinceObservation == null || rollup.daysSinceObservation > SEEN_WINDOW_DAYS) {
    return 'Schedule an observation, outside the 14 day window';
  }
  if (rollup.assessmentConcern) {
    return 'Review recent unit-test results with the teacher';
  }
  if (rollup.pacingStatus === 'yellow') {
    return 'Check in on pacing, 1 to 3 days behind';
  }
  return 'On track, maintain regular cadence';
}
