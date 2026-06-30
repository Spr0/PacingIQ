// ---------------------------------------------------------------------------
// Dashboard — the weekly instructional intelligence screen, styled to the
// Sierra Rams coaching-platform UI kit. Teachers needing attention rise to the
// top: behind pace, unseen, assessment concerns, action plans, risk, and
// upcoming unit tests. Read-only for all roles.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { isOverdue } from '../lib/intelligence.js';
import { formatDate, daysUntil } from '../lib/dates.js';
import { Icon } from '../components/icons.jsx';
import { Empty } from '../components/ui.jsx';

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const BAND = { green: 'green', yellow: 'amber', red: 'red' };

function latestCompleted(rollup) {
  return (rollup.assessments || []).find((a) => a.avgScore != null) || null;
}

function PCard({ icon, accent, eyebrow, title, count, linkTo, linkLabel, children }) {
  return (
    <section className={`pcard${accent ? ` pcard--accent-${accent}` : ''}`}>
      <div className="pcard__head">
        <span className="pcard__icon">
          <Icon name={icon} />
        </span>
        <div className="pcard__titles">
          <div className="pcard__eyebrow">{eyebrow}</div>
          <div className="pcard__title">
            {title}
            {count != null && <span className="count">{count}</span>}
          </div>
        </div>
        {linkTo && (
          <Link className="pcard__link" to={linkTo}>
            {linkLabel || 'View all'} <Icon name="arrow" />
          </Link>
        )}
      </div>
      <div className="pcard__body">{children}</div>
    </section>
  );
}

export default function Dashboard() {
  const { rollups, teachers, assessments, resetDemo } = useApp();
  const navigate = useNavigate();

  const total = rollups.length;
  const behindPace = useMemo(
    () => rollups.filter((r) => r.pacingStatus !== 'green'),
    [rollups]
  );
  const redRisk = useMemo(() => rollups.filter((r) => r.risk.band === 'red'), [rollups]);
  const compliant = useMemo(() => rollups.filter((r) => r.seenCompliant).length, [rollups]);
  const compliancePct = total ? Math.round((compliant / total) * 100) : 0;
  const overdueTotal = useMemo(
    () => rollups.reduce((s, r) => s + r.overdueActions.length, 0),
    [rollups]
  );
  const overdueTeachers = useMemo(
    () => rollups.filter((r) => r.overdueActions.length > 0).length,
    [rollups]
  );

  const behindRows = useMemo(
    () => [...behindPace].sort((a, b) => b.daysBehind - a.daysBehind),
    [behindPace]
  );

  const notSeenRows = useMemo(
    () =>
      [...rollups]
        .filter((r) => r.daysSinceObservation == null || r.daysSinceObservation > 10)
        .sort((a, b) => {
          const av = a.daysSinceObservation ?? Infinity;
          const bv = b.daysSinceObservation ?? Infinity;
          return bv - av;
        }),
    [rollups]
  );

  const assessmentRows = useMemo(
    () =>
      rollups
        .map((r) => ({ r, test: latestCompleted(r) }))
        .filter((x) => x.test != null)
        .sort((a, b) => Number(b.r.assessmentConcern) - Number(a.r.assessmentConcern)),
    [rollups]
  );

  const actionRows = useMemo(() => {
    const rows = [];
    rollups.forEach((r) =>
      r.outstandingActions.forEach((a) =>
        rows.push({ teacher: r.teacher, action: a, overdue: isOverdue(a) })
      )
    );
    return rows.sort((a, b) => Number(b.overdue) - Number(a.overdue));
  }, [rollups]);

  const riskCounts = useMemo(() => {
    const c = { green: 0, yellow: 0, red: 0 };
    rollups.forEach((r) => (c[r.risk.band] += 1));
    return c;
  }, [rollups]);

  const upcoming = useMemo(() => {
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));
    return assessments
      .filter((a) => a.avgScore === null && daysUntil(a.date) != null && daysUntil(a.date) >= 0)
      .map((a) => ({ a, teacherName: nameById.get(a.teacherId) || 'Unknown' }))
      .sort((x, y) => (x.a.date < y.a.date ? -1 : 1));
  }, [assessments, teachers]);

  const eyebrowDate = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();

  return (
    <div className="stack">
      {/* Hero header */}
      <div className="row row--between row--wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">{eyebrowDate}</div>
          <h1 className="display-title" style={{ marginTop: 6 }}>
            This week, see these teachers first
          </h1>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--ghost btn--sm" onClick={resetDemo}>
            Reset demo data
          </button>
          <button className="btn" onClick={() => navigate('/report')}>
            <Icon name="sparkle" /> Intelligent view
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid--auto">
        <div className="statcard statcard--red">
          <div className="statcard__label">Behind pace</div>
          <div className="statcard__value">{behindPace.length}</div>
          <div className="statcard__delta">
            {redRisk.length} at red risk this week
          </div>
        </div>
        <div className="statcard statcard--red">
          <div className="statcard__label">Red status</div>
          <div className="statcard__value">{redRisk.length}</div>
          <div className="statcard__delta">highest priority</div>
        </div>
        <div className="statcard statcard--green">
          <div className="statcard__label">Seen ≤ 14 days</div>
          <div className="statcard__value">
            {compliancePct}
            <span className="unit">%</span>
          </div>
          <div className="statcard__delta">
            {compliant} of {total} teachers
          </div>
        </div>
        <div className="statcard statcard--amber">
          <div className="statcard__label">Overdue actions</div>
          <div className="statcard__value">{overdueTotal}</div>
          <div className="statcard__delta">across {overdueTeachers} teachers</div>
        </div>
      </div>

      {/* Two-column priority layout */}
      <div className="dash-cols">
        {/* Left column */}
        <div className="stack">
          <PCard
            icon="flame"
            accent="red"
            eyebrow="Priority 1"
            title="Teachers behind pace"
            count={behindRows.length}
            linkTo="/pacing"
          >
            {behindRows.length === 0 ? (
              <Empty icon="✓">Every teacher is on pace this week.</Empty>
            ) : (
              behindRows.map((r) => (
                <div className="lrow" key={r.teacher.id}>
                  <span className={`chip chip--${BAND[r.risk.band]}`}>{initials(r.teacher.name)}</span>
                  <div className="lrow__main">
                    <div className="lrow__name">
                      <Link to={`/teachers/${r.teacher.id}`}>{r.teacher.name}</Link>
                    </div>
                    <div className="lrow__sub">
                      {r.teacher.subject} · Grade {r.teacher.gradeLevel}
                    </div>
                  </div>
                  <div className="lrow__mid">{r.pacing?.currentUnit || '—'}</div>
                  <div className="lrow__right">
                    <span className={`pill pill--${BAND[r.pacingStatus]}`}>
                      <span className="dot" />
                      {r.daysBehind}d behind
                    </span>
                    <span className={`pill pill--${BAND[r.risk.band]}`}>
                      <span className="dot" />
                      Risk {r.risk.score}
                    </span>
                  </div>
                </div>
              ))
            )}
          </PCard>

          <PCard
            icon="chart"
            eyebrow="Priority 3"
            title="Assessment performance"
            count={assessmentRows.length}
            linkTo="/teachers"
            linkLabel="Trends"
          >
            {assessmentRows.length === 0 ? (
              <Empty icon="📊">No completed unit tests yet.</Empty>
            ) : (
              assessmentRows.map(({ r, test }) => (
                <div className="lrow" key={r.teacher.id}>
                  <div className="lrow__main">
                    <div className="lrow__name">
                      <Link to={`/teachers/${r.teacher.id}`}>{r.teacher.name}</Link>
                    </div>
                    <div className="lrow__sub">{test.name}</div>
                  </div>
                  <div className="lrow__right">
                    <span className="mono small muted">
                      {test.avgScore} avg · {test.proficiencyPct ?? '—'}%
                    </span>
                    {r.assessmentTrend === 'up' && <span className="pill pill--green">▲ Up</span>}
                    {r.assessmentTrend === 'down' && <span className="pill pill--red">▼ Down</span>}
                    {r.assessmentConcern && <span className="pill pill--red">Concern</span>}
                  </div>
                </div>
              ))
            )}
          </PCard>

          <PCard
            icon="report"
            eyebrow="Priority 4"
            title="Coaching action plans"
            count={actionRows.length}
          >
            {actionRows.length === 0 ? (
              <Empty icon="✓">No outstanding action items.</Empty>
            ) : (
              actionRows.map(({ teacher, action, overdue }) => (
                <div className="lrow" key={`${teacher.id}-${action.id}`}>
                  <div className="lrow__main">
                    <div className="lrow__name">{action.description}</div>
                    <div className="lrow__sub">
                      <Link to={`/teachers/${teacher.id}`}>{teacher.name}</Link> · {action.owner}
                    </div>
                  </div>
                  <div className="lrow__right">
                    <span
                      className="small"
                      style={{ color: overdue ? 'var(--red-600)' : 'var(--text-muted)' }}
                    >
                      {formatDate(action.dueDate)}
                    </span>
                    <span className={`pill pill--${overdue ? 'red' : 'neutral'}`}>
                      {overdue ? 'Overdue' : action.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </PCard>
        </div>

        {/* Right column */}
        <div className="stack">
          <PCard
            icon="clock"
            eyebrow="Priority 2"
            title="Not seen recently"
            count={notSeenRows.length}
            linkTo="/observations"
          >
            {notSeenRows.length === 0 ? (
              <Empty icon="👁">All teachers seen within 10 days.</Empty>
            ) : (
              notSeenRows.map((r) => {
                const flagged = r.daysSinceObservation == null || r.daysSinceObservation > 14;
                return (
                  <div className="lrow" key={r.teacher.id}>
                    <span className={`chip chip--${BAND[r.risk.band]}`}>{initials(r.teacher.name)}</span>
                    <div className="lrow__main">
                      <div className="lrow__name">
                        <Link to={`/teachers/${r.teacher.id}`}>{r.teacher.name}</Link>
                      </div>
                      <div className="lrow__sub">
                        {r.teacher.subject} · Grade {r.teacher.gradeLevel}
                      </div>
                    </div>
                    <div
                      className="lrow__right mono"
                      style={{ color: flagged ? 'var(--red-600)' : 'var(--amber-600)', fontWeight: 600 }}
                    >
                      {r.daysSinceObservation == null ? 'Never' : `${r.daysSinceObservation}d`}
                    </div>
                  </div>
                );
              })
            )}
          </PCard>

          <PCard
            icon="pacing"
            eyebrow="Priority 6"
            title="Upcoming unit tests"
            count={upcoming.length}
          >
            {upcoming.length === 0 ? (
              <Empty icon="📅">No upcoming unit tests.</Empty>
            ) : (
              upcoming.map(({ a, teacherName }) => {
                const d = new Date(a.date);
                return (
                  <div className="lrow" key={a.id}>
                    <div className="datechip">
                      <div className="m">{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div className="d">{d.getDate()}</div>
                    </div>
                    <div className="lrow__main">
                      <div className="lrow__name">{a.name}</div>
                      <div className="lrow__sub">{teacherName}</div>
                    </div>
                    <div className="lrow__right mono small" style={{ color: 'var(--amber-600)', fontWeight: 600 }}>
                      in {daysUntil(a.date)}d
                    </div>
                  </div>
                );
              })
            )}
          </PCard>

          <PCard icon="interventions" eyebrow="Priority 5" title="Teacher risk score">
            <div className="row row--wrap" style={{ gap: 8, padding: '4px 2px 10px' }}>
              <span className="pill pill--green">
                <span className="dot" />
                Green {riskCounts.green}
              </span>
              <span className="pill pill--amber">
                <span className="dot" />
                Yellow {riskCounts.yellow}
              </span>
              <span className="pill pill--red">
                <span className="dot" />
                Red {riskCounts.red}
              </span>
            </div>
          </PCard>
        </div>
      </div>
    </div>
  );
}
