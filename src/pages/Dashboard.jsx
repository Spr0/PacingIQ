// ---------------------------------------------------------------------------
// Dashboard. The weekly instructional intelligence screen. Teachers needing
// attention rise to the top: behind-pace, unseen, assessment concerns, open
// action plans, risk distribution, and upcoming unit tests. Read-only for all
// roles. The only control is a ghost "Reset demo data" button.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { isOverdue } from '../lib/intelligence.js';
import { formatDate, daysUntil } from '../lib/dates.js';
import { Card, StatusBadge, RiskBadge, Badge, Empty } from '../components/ui.jsx';

const RED = 'var(--red)';

// Most recent completed unit test (avgScore present) for a rollup, or null.
function latestCompleted(rollup) {
  return (rollup.assessments || []).find((a) => a.avgScore != null) || null;
}

function trendBadge(trend) {
  if (trend === 'up') return <Badge tone="green">▲ Up</Badge>;
  if (trend === 'down') return <Badge tone="red">▼ Down</Badge>;
  return <Badge tone="neutral">▬ Flat</Badge>;
}

export default function Dashboard() {
  const { rollups, teachers, assessments, resetDemo } = useApp();

  // --- Stat tiles -----------------------------------------------------------
  const behindPace = useMemo(
    () => rollups.filter((r) => r.pacingStatus === 'yellow' || r.pacingStatus === 'red'),
    [rollups]
  );
  const redRisk = useMemo(() => rollups.filter((r) => r.risk.band === 'red'), [rollups]);
  const unseen = useMemo(
    () =>
      rollups.filter(
        (r) => r.daysSinceObservation == null || r.daysSinceObservation > 14
      ),
    [rollups]
  );
  const overdueTotal = useMemo(
    () => rollups.reduce((sum, r) => sum + r.overdueActions.length, 0),
    [rollups]
  );

  // --- 1. Teachers behind pace ----------------------------------------------
  const behindRows = useMemo(
    () => [...behindPace].sort((a, b) => b.daysBehind - a.daysBehind),
    [behindPace]
  );

  // --- 2. Not recently seen (emphasize > 10 days) ---------------------------
  const notSeenRows = useMemo(() => {
    return [...rollups]
      .filter((r) => r.daysSinceObservation == null || r.daysSinceObservation > 10)
      .sort((a, b) => {
        const av = a.daysSinceObservation == null ? Infinity : a.daysSinceObservation;
        const bv = b.daysSinceObservation == null ? Infinity : b.daysSinceObservation;
        return bv - av;
      });
  }, [rollups]);

  // --- 3. Assessment performance --------------------------------------------
  const assessmentRows = useMemo(() => {
    return rollups
      .map((r) => ({ rollup: r, test: latestCompleted(r) }))
      .filter((x) => x.test != null);
  }, [rollups]);

  // --- 4. Coaching action plans ---------------------------------------------
  const actionRows = useMemo(() => {
    const rows = [];
    rollups.forEach((r) => {
      r.outstandingActions.forEach((a) => {
        rows.push({
          teacher: r.teacher,
          action: a,
          overdue: isOverdue(a),
        });
      });
    });
    return rows.sort((a, b) => Number(b.overdue) - Number(a.overdue));
  }, [rollups]);

  // --- 5. Risk distribution -------------------------------------------------
  const riskCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0 };
    rollups.forEach((r) => {
      counts[r.risk.band] = (counts[r.risk.band] || 0) + 1;
    });
    return counts;
  }, [rollups]);

  const riskWatch = useMemo(
    () =>
      rollups
        .filter((r) => r.risk.band === 'red' || r.risk.band === 'yellow')
        .sort((a, b) => b.risk.score - a.risk.score),
    [rollups]
  );

  // --- 6. Upcoming unit tests -----------------------------------------------
  const upcoming = useMemo(() => {
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));
    return assessments
      .filter((a) => {
        if (a.avgScore !== null) return false;
        const d = daysUntil(a.date);
        return d != null && d >= 0;
      })
      .map((a) => ({ assessment: a, teacherName: nameById.get(a.teacherId) || 'Unknown' }))
      .sort((a, b) => (a.assessment.date < b.assessment.date ? -1 : 1));
  }, [assessments, teachers]);

  const showBanner = behindPace.length > 0 || redRisk.length > 0;

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div>
          <h2 className="section-title">Monday priorities</h2>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Weekly instructional intelligence. Teachers needing attention rise to the top.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={resetDemo}>
          Reset demo data
        </button>
      </div>

      {showBanner && (
        <div className="banner banner--info">
          {behindPace.length} teacher{behindPace.length === 1 ? '' : 's'} behind pace and{' '}
          {redRisk.length} at red risk this week. Start with the teachers listed below.
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid--auto">
        <div className="card">
          <div className="stat">
            <span className="stat__value">{behindPace.length}</span>
            <span className="stat__label">Teachers behind pace</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value" style={redRisk.length ? { color: RED } : undefined}>
              {redRisk.length}
            </span>
            <span className="stat__label">Red-status teachers</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value">{unseen.length}</span>
            <span className="stat__label">Not seen in 14+ days</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value" style={overdueTotal ? { color: RED } : undefined}>
              {overdueTotal}
            </span>
            <span className="stat__label">Overdue action items</span>
          </div>
        </div>
      </div>

      {/* 1. Teachers Behind Pace (full width) */}
      <Card title="Teachers Behind Pace" count={behindRows.length} flush>
        {behindRows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="✓">Every teacher is on pace this week.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Subject</th>
                <th className="num">Days Behind</th>
                <th>Pacing</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {behindRows.map((r) => (
                <tr key={r.teacher.id}>
                  <td>
                    <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                      {r.teacher.name}
                    </Link>
                  </td>
                  <td>{r.teacher.subject || '—'}</td>
                  <td className="num">{r.daysBehind}</td>
                  <td>
                    <StatusBadge status={r.pacingStatus} />
                  </td>
                  <td>
                    <RiskBadge risk={r.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 2-column band: Not Recently Seen + Assessment Performance */}
      <div className="grid grid--2">
        <Card title="Not Recently Seen" count={notSeenRows.length} flush>
          {notSeenRows.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty icon="👁">All teachers observed within the last 10 days.</Empty>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Last Visit</th>
                  <th className="num">Days Since</th>
                </tr>
              </thead>
              <tbody>
                {notSeenRows.map((r) => {
                  const flagged =
                    r.daysSinceObservation == null || r.daysSinceObservation > 14;
                  return (
                    <tr key={r.teacher.id}>
                      <td>
                        <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                          {r.teacher.name}
                        </Link>
                      </td>
                      <td>
                        {r.lastObservation ? formatDate(r.lastObservation.date) : 'Never'}
                      </td>
                      <td className="num" style={flagged ? { color: RED } : undefined}>
                        {r.daysSinceObservation == null ? '—' : r.daysSinceObservation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Assessment Performance" count={assessmentRows.length} flush>
          {assessmentRows.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty icon="📊">No completed unit tests recorded yet.</Empty>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Unit Test</th>
                  <th className="num">Avg</th>
                  <th className="num">Prof %</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {assessmentRows.map(({ rollup: r, test }) => (
                  <tr key={r.teacher.id}>
                    <td>
                      <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                        {r.teacher.name}
                      </Link>
                    </td>
                    <td>
                      {test.name}{' '}
                      {r.assessmentConcern && <Badge tone="red">Concern</Badge>}
                    </td>
                    <td className="num">{test.avgScore}</td>
                    <td className="num">
                      {test.proficiencyPct == null ? '—' : test.proficiencyPct}
                    </td>
                    <td>{trendBadge(r.assessmentTrend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* 4. Coaching Action Plans (full width) */}
      <Card title="Coaching Action Plans" count={actionRows.length} flush>
        {actionRows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="✓">No outstanding action items.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Description</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {actionRows.map(({ teacher, action, overdue }) => (
                <tr key={`${teacher.id}-${action.id}`}>
                  <td>
                    <Link className="tname" to={`/teachers/${teacher.id}`}>
                      {teacher.name}
                    </Link>
                  </td>
                  <td>{action.description || '—'}</td>
                  <td>{action.owner || '—'}</td>
                  <td style={overdue ? { color: RED } : undefined}>
                    {formatDate(action.dueDate)}{' '}
                    {overdue && <Badge tone="red">Overdue</Badge>}
                  </td>
                  <td>{action.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 2-column band: Risk Score + Upcoming Unit Tests */}
      <div className="grid grid--2">
        <Card title="Teacher Risk Score">
          <div className="row row--wrap" style={{ gap: 8, marginBottom: 12 }}>
            <span className="badge badge--green">Green · {riskCounts.green}</span>
            <span className="badge badge--yellow">Yellow · {riskCounts.yellow}</span>
            <span className="badge badge--red">Red · {riskCounts.red}</span>
          </div>
          {riskWatch.length === 0 ? (
            <Empty icon="✓">No yellow or red risk teachers.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Risk</th>
                  <th>Top Factor</th>
                </tr>
              </thead>
              <tbody>
                {riskWatch.map((r) => (
                  <tr key={r.teacher.id}>
                    <td>
                      <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                        {r.teacher.name}
                      </Link>
                    </td>
                    <td>
                      <RiskBadge risk={r.risk} />
                    </td>
                    <td className="small muted">{r.risk.factors[0] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Upcoming Unit Tests" count={upcoming.length} flush>
          {upcoming.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty icon="📅">No upcoming unit tests scheduled.</Empty>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Teacher</th>
                  <th>Date</th>
                  <th className="num">In</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map(({ assessment, teacherName }) => (
                  <tr key={assessment.id}>
                    <td>{assessment.name}</td>
                    <td>{teacherName}</td>
                    <td>{formatDate(assessment.date)}</td>
                    <td className="num">{daysUntil(assessment.date)} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
