// ---------------------------------------------------------------------------
// Teacher detail hub. A read-only record for a single teacher: header with
// risk and compliance badges, stat tiles, a risk explanation, and tabbed views
// for observations, pacing, assessments, interventions, and coaching notes.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { pacingStatus, recommendedAction, isOverdue } from '../lib/intelligence.js';
import { formatDate, daysUntil } from '../lib/dates.js';
import { can } from '../lib/permissions.js';
import {
  Card,
  StatusBadge,
  RiskBadge,
  Badge,
  Empty,
  Modal,
  InfoTip,
  RISK_SCORE_TOOLTIP,
  PACING_STATUS_TOOLTIP,
} from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import CoachAssistant from '../components/CoachAssistant.jsx';
import ActionPlans from '../components/ActionPlans.jsx';
import Goals from '../components/Goals.jsx';
import LessonPlanReader from '../components/LessonPlanReader.jsx';

const TABS = [
  'Overview',
  'Observations',
  'Pacing',
  'Assessments',
  'Interventions',
  'Goals',
  'Action Plans',
  'Coaching Notes',
];

const ENGAGEMENT_TONE = { Low: 'red', Medium: 'yellow', High: 'green' };

export default function TeacherDetail() {
  const { id } = useParams();
  const {
    rollupFor,
    observations,
    pacingEntries,
    assessments,
    interventions,
    actionPlans,
    actionPlanTemplates,
    goals,
    db,
    roleKey,
  } = useApp();
  const rollup = rollupFor(id);
  const writable = can(roleKey, 'write');

  const [tab, setTab] = useState('Overview');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInitialKind, setAiInitialKind] = useState('summary');
  const [lessonReaderOpen, setLessonReaderOpen] = useState(false);

  function openAi(kind) {
    setAiInitialKind(kind);
    setAiOpen(true);
  }

  const myObservations = useMemo(
    () =>
      observations
        .filter((o) => o.teacherId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [observations, id]
  );
  const myPacing = useMemo(
    () =>
      pacingEntries
        .filter((p) => p.teacherId === id)
        .sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1)),
    [pacingEntries, id]
  );
  const myAssessments = useMemo(
    () =>
      assessments
        .filter((a) => a.teacherId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [assessments, id]
  );
  const myInterventions = useMemo(
    () => interventions.filter((i) => i.teacherId === id),
    [interventions, id]
  );
  const myActionPlans = useMemo(
    () => actionPlans.filter((p) => p.teacherId === id),
    [actionPlans, id]
  );
  const myGoals = useMemo(() => goals.filter((g) => g.teacherId === id), [goals, id]);

  if (!rollup) {
    return (
      <Empty icon="🗂">
        Teacher not found. <Link to="/teachers">Back to roster</Link>
      </Empty>
    );
  }

  const { teacher, risk, pacing } = rollup;
  const dsObs = rollup.daysSinceObservation;

  const pacingLabel =
    rollup.daysBehind > 0 ? `${rollup.daysBehind} days behind` : 'On pace';

  let seenBadge;
  if (dsObs == null) {
    seenBadge = <Badge tone="red">Never observed</Badge>;
  } else if (rollup.seenCompliant) {
    seenBadge = <Badge tone="green">Seen {dsObs}d ago</Badge>;
  } else {
    seenBadge = <Badge tone="red">Not seen in {dsObs}d</Badge>;
  }

  return (
    <div className="stack">
      <div className="stack">
        <Link to="/teachers" className="muted small">
          Back to roster
        </Link>
        <div className="row row--between row--wrap" style={{ gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{teacher.name}</h1>
            <p className="muted">
              {[teacher.subject, teacher.gradeLevel ? `Grade ${teacher.gradeLevel}` : null, teacher.assignedAdmin]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {writable && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--primary" onClick={() => openAi('action_plan')}>
                <Icon name="sparkle" /> Generate Action Plan with AI
              </button>
              <button className="btn btn--ghost" onClick={() => openAi('summary')}>
                <Icon name="sparkle" /> AI assist
              </button>
              <button className="btn btn--ghost" onClick={() => setLessonReaderOpen(true)}>
                <Icon name="sparkle" /> Read Lesson Plan with AI
              </button>
            </div>
          )}
        </div>
        <div className="row row--wrap" style={{ gap: 8 }}>
          <RiskBadge risk={risk} />
          {rollup.multiSubject ? (
            rollup.pacingBySubject.map((sp) => (
              <StatusBadge
                key={sp.subject}
                status={sp.status}
                label={`${sp.label} · ${sp.daysBehind > 0 ? `${sp.daysBehind}d behind` : 'On pace'}`}
              />
            ))
          ) : (
            <StatusBadge status={rollup.pacingStatus} label={pacingLabel} />
          )}
          {seenBadge}
        </div>
      </div>

      <div className="grid grid--auto">
        <Stat
          value={risk.score}
          label={
            <>
              Risk score
              <InfoTip text={RISK_SCORE_TOOLTIP} />
            </>
          }
        />
        <Stat
          value={rollup.daysBehind}
          label={
            <>
              Days behind
              <InfoTip text={PACING_STATUS_TOOLTIP} />
            </>
          }
        />
        <Stat value={dsObs == null ? '—' : dsObs} label="Days since observation" />
        <Stat value={rollup.outstandingActions.length} label="Outstanding actions" />
      </div>

      {risk.factors.length > 0 && (
        <div className="banner banner--warn">
          <strong>Why this risk score</strong>
          <div className="mt-1">{risk.factors.join(' · ')}</div>
        </div>
      )}

      <div className="pill-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={t === tab ? 'active' : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab rollup={rollup} />}
      {tab === 'Observations' && <ObservationsTab observations={myObservations} />}
      {tab === 'Pacing' && <PacingTab entries={myPacing} />}
      {tab === 'Assessments' && <AssessmentsTab assessments={myAssessments} />}
      {tab === 'Interventions' && <InterventionsTab interventions={myInterventions} />}
      {tab === 'Goals' && (
        <Goals teacherId={id} teacherName={teacher.name} goals={myGoals} db={db} writable={writable} />
      )}
      {tab === 'Action Plans' && (
        <ActionPlans
          teacherId={id}
          plans={myActionPlans}
          templates={actionPlanTemplates}
          db={db}
          writable={writable}
        />
      )}
      {tab === 'Coaching Notes' && <CoachingNotesTab observations={myObservations} />}

      {aiOpen && (
        <CoachAssistant
          rollup={rollup}
          observations={myObservations}
          assessments={myAssessments}
          initialKind={aiInitialKind}
          onClose={() => setAiOpen(false)}
        />
      )}

      {lessonReaderOpen && (
        <LessonPlanReader teacher={teacher} onClose={() => setLessonReaderOpen(false)} />
      )}
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewTab({ rollup }) {
  const { pacing } = rollup;
  const actions = rollup.outstandingActions;
  return (
    <div className="grid grid--2">
      <div className="stack">
        <Card title="Next recommended support">
          <p style={{ fontSize: 18, lineHeight: 1.4, margin: 0 }}>
            {recommendedAction(rollup)}
          </p>
        </Card>
        <Card title="Current pacing">
          {rollup.multiSubject ? (
            <div className="stack">
              {rollup.pacingBySubject.map((sp) => (
                <div key={sp.subject} className="stack" style={{ gap: 4 }}>
                  <div className="row row--between">
                    <strong className="small">{sp.label}</strong>
                    <StatusBadge
                      status={sp.status}
                      label={sp.daysBehind > 0 ? `${sp.daysBehind} days behind` : 'On pace'}
                    />
                  </div>
                  <KV k="Unit" v={sp.pacing.currentUnit || '—'} />
                  <KV k="Lesson" v={sp.pacing.currentLesson || '—'} />
                  <KV k="Standard" v={sp.pacing.currentStandard || '—'} />
                </div>
              ))}
            </div>
          ) : pacing ? (
            <div className="stack">
              <KV k="Unit" v={pacing.currentUnit || '—'} />
              <KV k="Lesson" v={pacing.currentLesson || '—'} />
              <KV k="Standard" v={pacing.currentStandard || '—'} />
              <KV
                k="Status"
                v={
                  <StatusBadge
                    status={rollup.pacingStatus}
                    label={rollup.daysBehind > 0 ? `${rollup.daysBehind} days behind` : 'On pace'}
                  />
                }
              />
            </div>
          ) : (
            <Empty icon="📅">No pacing entries recorded yet.</Empty>
          )}
        </Card>
      </div>
      <Card title="Outstanding action items" count={actions.length}>
        {actions.length === 0 ? (
          <Empty icon="✓">No outstanding action items.</Empty>
        ) : (
          <ul className="checklist">
            {actions.map((a) => {
              const overdue = isOverdue(a);
              return (
                <li key={a.id}>
                  <span className="check check--todo">✓</span>
                  <span>
                    {a.description}
                    <span className="muted small">
                      {' '}
                      · {a.source}
                      {a.dueDate && (
                        <span style={overdue ? { color: 'var(--red)' } : undefined}>
                          {' '}
                          · due {formatDate(a.dueDate)}
                          {overdue ? ' (overdue)' : ''}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="row row--between" style={{ gap: 12 }}>
      <span className="muted small">{k}</span>
      <span>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------
function ObservationsTab({ observations }) {
  const [open, setOpen] = useState(null);
  if (observations.length === 0) {
    return (
      <Card flush>
        <div style={{ padding: 24 }}>
          <Empty icon="👀">No observations recorded for this teacher.</Empty>
        </div>
      </Card>
    );
  }
  return (
    <>
      <Card title="Observations" count={observations.length} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Lesson</th>
              <th>Standard</th>
              <th>Engagement</th>
              <th>Notes</th>
              <th>Follow-up</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {observations.map((o) => (
              <tr key={o.id}>
                <td>{formatDate(o.date)}</td>
                <td>{o.lessonObserved || '—'}</td>
                <td>{o.standard || '—'}</td>
                <td>
                  {o.engagementLevel ? (
                    <Badge tone={ENGAGEMENT_TONE[o.engagementLevel] || 'neutral'}>
                      {o.engagementLevel}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="muted small">{excerpt(o.strengths || o.areasForGrowth)}</td>
                <td>{o.followUpObservationDate ? formatDate(o.followUpObservationDate) : '—'}</td>
                <td>
                  <button className="btn btn--ghost btn--sm" onClick={() => setOpen(o)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {open && (
        <Modal
          title={`Observation · ${formatDate(open.date)}`}
          onClose={() => setOpen(null)}
          maxWidth={640}
          footer={
            <button className="btn btn--primary" onClick={() => setOpen(null)}>
              Close
            </button>
          }
        >
          <div className="stack">
            <div className="row row--wrap" style={{ gap: 8 }}>
              {open.engagementLevel && (
                <Badge tone={ENGAGEMENT_TONE[open.engagementLevel] || 'neutral'}>
                  Engagement: {open.engagementLevel}
                </Badge>
              )}
              {open.sharedWithTeacher?.whole ? (
                <Badge tone="green">Shared with teacher</Badge>
              ) : (
                <Badge tone="neutral">Not shared with teacher</Badge>
              )}
            </div>
            <DetailRow k="Lesson observed" v={open.lessonObserved} />
            <DetailRow k="Standard" v={open.standard} />
            <DetailRow k="Evidence" v={open.evidence} />
            <DetailRow k="Evidence of learning" v={open.evidenceOfLearning} />
            <DetailRow k="Teacher actions" v={open.teacherActions} />
            <DetailRow k="Student actions" v={open.studentActions} />
            <DetailRow k="Strengths" v={open.strengths} />
            <DetailRow k="Areas for growth" v={open.areasForGrowth} />
            <DetailRow k="Feedback provided" v={open.feedbackProvided} />
            <DetailRow
              k="Follow-up observation"
              v={open.followUpObservationDate ? formatDate(open.followUpObservationDate) : null}
            />
            <div>
              <div className="section-title">Action items</div>
              {(open.actionItems || []).length === 0 ? (
                <p className="muted small">None recorded.</p>
              ) : (
                <ul className="checklist">
                  {open.actionItems.map((a) => (
                    <li key={a.id}>
                      <span
                        className={
                          a.status === 'Complete' ? 'check check--done' : 'check check--todo'
                        }
                      >
                        ✓
                      </span>
                      <span>
                        {a.description}
                        <span className="muted small">
                          {a.owner ? ` · ${a.owner}` : ''}
                          {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : ''}
                          {a.status ? ` · ${a.status}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function DetailRow({ k, v }) {
  return (
    <div>
      <div className="muted small">{k}</div>
      <div>{v || '—'}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------
function PacingTab({ entries }) {
  if (entries.length === 0) {
    return (
      <Card flush>
        <div style={{ padding: 24 }}>
          <Empty icon="📅">No pacing entries recorded for this teacher.</Empty>
        </div>
      </Card>
    );
  }
  const hasSubjects = entries.some((p) => p.subject);

  return (
    <Card title="Pacing history" count={entries.length} flush>
      <table className="table">
        <thead>
          <tr>
            <th>Week of</th>
            {hasSubjects && <th>Subject</th>}
            <th>Unit</th>
            <th>Lesson</th>
            <th>Standard</th>
            <th className="num">Days behind</th>
            <th>Status</th>
            <th>Exception</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((p) => {
            const behind = Number(p.daysBehind) || 0;
            return (
              <tr key={p.id}>
                <td>{formatDate(p.weekOf)}</td>
                {hasSubjects && <td>{p.subject || '—'}</td>}
                <td>{p.currentUnit || '—'}</td>
                <td>{p.currentLesson || '—'}</td>
                <td>{p.currentStandard || '—'}</td>
                <td className="num">{behind}</td>
                <td>
                  <StatusBadge status={pacingStatus(behind)} />
                </td>
                <td>{p.exceptionReason ? <Badge tone="neutral">{p.exceptionReason}</Badge> : '—'}</td>
                <td className="muted small">{p.notes || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------
function AssessmentsTab({ assessments }) {
  const completed = assessments.filter((a) => a.avgScore != null);
  const upcoming = assessments
    .filter((a) => a.avgScore == null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="stack">
      <Card title="Completed unit tests" count={completed.length} flush>
        {completed.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="📊">No completed unit tests yet.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th className="num">Avg score</th>
                <th className="num">Proficiency %</th>
              </tr>
            </thead>
            <tbody>
              {completed.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{formatDate(a.date)}</td>
                  <td className="num">{a.avgScore}</td>
                  <td className="num">{a.proficiencyPct == null ? '—' : `${a.proficiencyPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {upcoming.length > 0 && (
        <Card title="Upcoming" count={upcoming.length} flush>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th className="num">Days until</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((a) => {
                const du = daysUntil(a.date);
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{formatDate(a.date)}</td>
                    <td className="num">{du == null ? '—' : du}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------
const INTERVENTION_TONE = { Open: 'yellow', 'In Progress': 'brand', Complete: 'green' };

const REQUIREMENT_LABELS = [
  ['caseCreated', 'Case created'],
  ['actionPlan', 'Action plan'],
  ['coachingMeetingScheduled', 'Coaching meeting scheduled'],
  ['followUpObservation', 'Follow-up observation'],
  ['leadershipReview', 'Leadership review'],
];

function InterventionsTab({ interventions }) {
  if (interventions.length === 0) {
    return (
      <Card flush>
        <div style={{ padding: 24 }}>
          <Empty icon="🛟">
            No interventions for this teacher. <Link to="/interventions">Go to interventions</Link>
          </Empty>
        </div>
      </Card>
    );
  }
  return (
    <div className="stack">
      {interventions.map((iv) => (
        <Card
          key={iv.id}
          title={iv.concern || 'Intervention'}
          action={<Badge tone={INTERVENTION_TONE[iv.status] || 'neutral'}>{iv.status}</Badge>}
        >
          <div className="stack">
            <DetailRow k="Root cause" v={iv.rootCause} />
            <div className="row row--wrap" style={{ gap: 16 }}>
              <KV k="Due" v={iv.dueDate ? formatDate(iv.dueDate) : '—'} />
              <KV k="Follow-up" v={iv.followUpDate ? formatDate(iv.followUpDate) : '—'} />
            </div>

            <div>
              <div className="section-title">Requirements</div>
              <ul className="checklist">
                {REQUIREMENT_LABELS.map(([key, label]) => {
                  const done = iv.requirements?.[key];
                  return (
                    <li key={key}>
                      <span className={done ? 'check check--done' : 'check check--todo'}>✓</span>
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <div className="section-title">Agreed actions</div>
              {(iv.agreedActions || []).length === 0 ? (
                <p className="muted small">None recorded.</p>
              ) : (
                <ul className="checklist">
                  {iv.agreedActions.map((a) => (
                    <li key={a.id}>
                      <span
                        className={
                          a.status === 'Complete' ? 'check check--done' : 'check check--todo'
                        }
                      >
                        ✓
                      </span>
                      <span>
                        {a.description}
                        <span className="muted small">
                          {a.owner ? ` · ${a.owner}` : ''}
                          {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : ''}
                          {a.status ? ` · ${a.status}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Link to="/interventions" className="muted small">
              Manage on the interventions page
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coaching Notes
// ---------------------------------------------------------------------------
function CoachingNotesTab({ observations }) {
  const notes = useMemo(() => {
    const out = [];
    observations.forEach((o) => {
      const shared = !!o.sharedWithTeacher?.whole;
      if (o.strengths) out.push({ id: `${o.id}-s`, date: o.date, kind: 'Strength', text: o.strengths, shared });
      if (o.areasForGrowth)
        out.push({ id: `${o.id}-g`, date: o.date, kind: 'Area for growth', text: o.areasForGrowth, shared });
      if (o.feedbackProvided)
        out.push({ id: `${o.id}-f`, date: o.date, kind: 'Feedback', text: o.feedbackProvided, shared });
    });
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [observations]);

  return (
    <Card title="Coaching notes" count={notes.length}>
      <p className="muted small mb-2">
        Coaching notes are visible to coach, principal, and assistant principals. Nothing is shared
        with the teacher automatically.
      </p>
      {notes.length === 0 ? (
        <Empty icon="📝">No coaching notes captured yet.</Empty>
      ) : (
        <ul className="timeline">
          {notes.map((n) => (
            <li key={n.id} className="timeline__item">
              <div className="timeline__time">{formatDate(n.date)}</div>
              <div className="row row--wrap" style={{ gap: 8, marginBottom: 4 }}>
                <Badge tone="brand">{n.kind}</Badge>
                {n.shared ? (
                  <Badge tone="green">Shared with teacher</Badge>
                ) : (
                  <Badge tone="neutral">Not shared</Badge>
                )}
              </div>
              <div>{n.text}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function excerpt(text, len = 60) {
  if (!text) return '—';
  return text.length > len ? `${text.slice(0, len)}…` : text;
}
