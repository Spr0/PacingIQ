// ---------------------------------------------------------------------------
// Weekly Coach Intelligence Email.
//
// The spec's Tuesday-morning digest, delivered to the coach only. It is fully
// data-driven from the rollup intelligence: teachers behind pace, new red
// status, upcoming unit tests, overdue actions, teachers not visited in 10+
// days, interventions needing attention, and recommended observation
// priorities. Every teacher reference deep-links to the teacher record.
//
// In the demo, "Mark as sent" only logs an audit entry. No real email is sent
// (that happens on the re-platformed MS Copilot / Power Automate side).
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { isOverdue, recommendedAction, SEEN_WINDOW_DAYS } from '../lib/intelligence.js';
import { formatDate, daysUntil } from '../lib/dates.js';
import { Icon } from '../components/icons.jsx';

const NOT_VISITED_DAYS = 10; // spec: teachers not visited in 10+ days

function TLink({ teacher }) {
  return (
    <Link to={`/teachers/${teacher.id}`} style={{ fontWeight: 600, color: 'var(--text-strong)' }}>
      {teacher.name}
    </Link>
  );
}

function Section({ icon, title, count, empty, children }) {
  return (
    <div style={{ padding: '18px 22px', borderTop: '1px solid var(--border-subtle)' }}>
      <div className="row" style={{ gap: 9, marginBottom: count ? 10 : 0 }}>
        <span style={{ color: 'var(--purple-600)', display: 'grid', placeItems: 'center', width: 18 }}>
          <Icon name={icon} />
        </span>
        <h3 style={{ fontSize: 'var(--text-subheading)' }}>{title}</h3>
        <span className="pcard__title" style={{ marginLeft: 2 }}>
          <span className="count">{count}</span>
        </span>
      </div>
      {count === 0 ? <p className="muted small" style={{ margin: 0 }}>{empty}</p> : children}
    </div>
  );
}

export default function WeeklyEmail() {
  const { rollups, teachers, assessments, interventions, db, user } = useApp();
  const coach = user;
  const [sentAt, setSentAt] = useState(null);

  const behind = useMemo(
    () => rollups.filter((r) => r.pacingStatus !== 'green').sort((a, b) => b.daysBehind - a.daysBehind),
    [rollups]
  );
  const redStatus = useMemo(
    () => rollups.filter((r) => r.risk.band === 'red').sort((a, b) => b.risk.score - a.risk.score),
    [rollups]
  );
  const overdue = useMemo(() => {
    const rows = [];
    rollups.forEach((r) =>
      r.overdueActions.forEach((a) => rows.push({ teacher: r.teacher, action: a }))
    );
    return rows;
  }, [rollups]);
  const notVisited = useMemo(
    () =>
      rollups
        .filter((r) => r.daysSinceObservation == null || r.daysSinceObservation >= NOT_VISITED_DAYS)
        .sort((a, b) => (b.daysSinceObservation ?? 999) - (a.daysSinceObservation ?? 999)),
    [rollups]
  );
  const upcoming = useMemo(() => {
    const nameById = new Map(teachers.map((t) => [t.id, t]));
    return assessments
      .filter((a) => {
        const d = daysUntil(a.date);
        return a.avgScore === null && d != null && d >= 0 && d <= 14;
      })
      .map((a) => ({ a, teacher: nameById.get(a.teacherId) }))
      .sort((x, y) => (x.a.date < y.a.date ? -1 : 1));
  }, [assessments, teachers]);
  const interventionAttention = useMemo(() => {
    const byId = new Map(teachers.map((t) => [t.id, t]));
    return interventions
      .filter((iv) => iv.status !== 'Complete')
      .map((iv) => {
        const reqs = iv.requirements || {};
        const incomplete = Object.values(reqs).filter((v) => !v).length;
        const overdueCase = isOverdue({ dueDate: iv.dueDate, status: iv.status });
        return { iv, teacher: byId.get(iv.teacherId), incomplete, overdueCase };
      });
  }, [interventions, teachers]);
  const recommended = useMemo(
    () =>
      rollups
        .filter(
          (r) =>
            r.daysSinceObservation == null ||
            r.daysSinceObservation > SEEN_WINDOW_DAYS ||
            r.risk.band !== 'green'
        )
        .sort((a, b) => b.risk.score - a.risk.score)
        .slice(0, 5),
    [rollups]
  );

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  function markSent() {
    db.audit('sent weekly intelligence email', `To: ${coach.name} (${coach.label})`);
    setSentAt(new Date());
  }

  return (
    <div className="stack" style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
      <div className="row row--between row--wrap">
        <p className="muted small" style={{ margin: 0 }}>
          Delivered every Tuesday morning to the coach. This is a live preview of this week's digest.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--sm" onClick={() => window.print()}>
            <Icon name="report" /> Print
          </button>
          <button className="btn btn--primary btn--sm" onClick={markSent}>
            <Icon name="mail" /> Mark as sent
          </button>
        </div>
      </div>

      {sentAt && (
        <div className="banner banner--info">
          Logged as sent to {coach.name} at {sentAt.toLocaleTimeString()}. No real email is delivered in
          the demo. On the re-platformed system this dispatches via the school's mail automation.
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        {/* Email header band */}
        <div style={{ background: 'linear-gradient(135deg, var(--purple-800), var(--purple-900))', color: '#fff', padding: '22px 22px 20px' }}>
          <div className="eyebrow" style={{ color: 'var(--gold-400)' }}>
            Sierra Rams · Coaching Intelligence
          </div>
          <h2 style={{ color: '#fff', fontSize: 'var(--text-title)', marginTop: 8 }}>
            Weekly Instructional Intelligence Summary
          </h2>
          <div className="small" style={{ color: 'var(--purple-200)', marginTop: 10, display: 'grid', gap: 2 }}>
            <span>
              <span style={{ color: 'var(--purple-300)' }}>To:</span> {coach.name} ({coach.label})
            </span>
            <span>
              <span style={{ color: 'var(--purple-300)' }}>Sent:</span> {dateLabel}, 7:00 AM
            </span>
          </div>
        </div>

        {/* Snapshot row */}
        <div className="row row--wrap" style={{ gap: 8, padding: '16px 22px' }}>
          <span className="pill pill--red"><span className="dot" />{behind.length} behind pace</span>
          <span className="pill pill--red"><span className="dot" />{redStatus.length} red status</span>
          <span className="pill pill--amber"><span className="dot" />{overdue.length} overdue actions</span>
          <span className="pill pill--brand">{notVisited.length} not seen 10+ days</span>
          <span className="pill pill--blue"><span className="dot" />{upcoming.length} upcoming tests</span>
        </div>

        {/* 1. Teachers behind pace */}
        <Section icon="flame" title="Teachers behind pace" count={behind.length} empty="Everyone is on pace this week.">
          <div className="stack" style={{ gap: 6 }}>
            {behind.map((r) => (
              <div className="row row--between" key={r.teacher.id} style={{ gap: 10 }}>
                <span><TLink teacher={r.teacher} /> <span className="muted small">· {r.teacher.subject}</span></span>
                <span className={`pill pill--${r.pacingStatus === 'red' ? 'red' : 'amber'}`}>
                  <span className="dot" />{r.daysBehind}d behind · {r.pacing?.currentUnit || '—'}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* 2. New red status */}
        <Section icon="interventions" title="Red status teachers" count={redStatus.length} empty="No teachers at red status.">
          <div className="stack" style={{ gap: 6 }}>
            {redStatus.map((r) => (
              <div className="row row--between" key={r.teacher.id} style={{ gap: 10 }}>
                <span><TLink teacher={r.teacher} /> <span className="muted small">· {r.teacher.subject}</span></span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="pill pill--red"><span className="dot" />Risk {r.risk.score}</span>
                  <span className="muted small">{r.risk.factors[0]}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* 3. Upcoming unit tests */}
        <Section icon="pacing" title="Upcoming unit tests (next 14 days)" count={upcoming.length} empty="No unit tests in the next two weeks.">
          <div className="stack" style={{ gap: 6 }}>
            {upcoming.map(({ a, teacher }) => (
              <div className="row row--between" key={a.id} style={{ gap: 10 }}>
                <span>{a.name} {teacher && <span className="muted small">· {teacher.name}</span>}</span>
                <span className="pill pill--blue">{formatDate(a.date)} · in {daysUntil(a.date)}d</span>
              </div>
            ))}
          </div>
        </Section>

        {/* 4. Overdue coaching actions */}
        <Section icon="report" title="Overdue coaching actions" count={overdue.length} empty="No overdue action items.">
          <div className="stack" style={{ gap: 6 }}>
            {overdue.map(({ teacher, action }) => (
              <div className="row row--between" key={`${teacher.id}-${action.id}`} style={{ gap: 10 }}>
                <span>{action.description} <span className="muted small">· <TLink teacher={teacher} /></span></span>
                <span className="pill pill--red"><span className="dot" />Due {formatDate(action.dueDate)}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* 5. Not visited in 10+ days */}
        <Section icon="clock" title="Not visited in 10+ days" count={notVisited.length} empty="All teachers seen within 10 days.">
          <div className="stack" style={{ gap: 6 }}>
            {notVisited.map((r) => (
              <div className="row row--between" key={r.teacher.id} style={{ gap: 10 }}>
                <span><TLink teacher={r.teacher} /> <span className="muted small">· {r.teacher.subject}</span></span>
                <span
                  className="mono small"
                  style={{
                    fontWeight: 600,
                    color: r.daysSinceObservation == null || r.daysSinceObservation > SEEN_WINDOW_DAYS
                      ? 'var(--red-600)' : 'var(--amber-600)',
                  }}
                >
                  {r.daysSinceObservation == null ? 'Never observed' : `${r.daysSinceObservation}d ago`}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* 6. Interventions requiring attention */}
        <Section icon="interventions" title="Interventions requiring attention" count={interventionAttention.length} empty="No open intervention cases.">
          <div className="stack" style={{ gap: 6 }}>
            {interventionAttention.map(({ iv, teacher, incomplete, overdueCase }) => (
              <div className="row row--between" key={iv.id} style={{ gap: 10 }}>
                <span>{teacher ? <TLink teacher={teacher} /> : 'Unknown'} <span className="muted small">· {iv.status}</span></span>
                <span className="row" style={{ gap: 8 }}>
                  {overdueCase && <span className="pill pill--red"><span className="dot" />Past due</span>}
                  <span className="pill pill--amber">{incomplete} step{incomplete === 1 ? '' : 's'} open</span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* 7. Recommended observation priorities */}
        <Section icon="observations" title="Recommended observation priorities" count={recommended.length} empty="No priority observations this week.">
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            {recommended.map((r) => (
              <li key={r.teacher.id}>
                <TLink teacher={r.teacher} />
                <span className="muted small"> · {r.teacher.subject}</span>
                <div className="small" style={{ color: 'var(--purple-700)', marginTop: 2 }}>
                  {recommendedAction(r)}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}>
          <p className="muted small" style={{ margin: 0 }}>
            Generated from this week's pacing, observation, assessment, and intervention records. Teacher
            names link to the full record. Delivered every Tuesday at 7:00 AM to the coach.
          </p>
        </div>
      </div>
    </div>
  );
}
