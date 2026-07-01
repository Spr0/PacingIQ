// ---------------------------------------------------------------------------
// Coaching Impact Report. The primary single-page school-health view. One dense
// table, one row per teacher, sorted by risk score so the most at-risk teachers
// sit at the top. A compact summary band and a print/export action sit above.
// Read-only for all roles.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { recommendedAction } from '../lib/intelligence.js';
import { formatDate, isoDate } from '../lib/dates.js';
import { Card, RiskBadge, Badge, Empty, InfoTip, RISK_SCORE_TOOLTIP, PACING_STATUS_TOOLTIP } from '../components/ui.jsx';

const RED = 'var(--red)';

// Most recent completed unit test (avgScore present) for a rollup, or null.
function latestCompleted(rollup) {
  return (rollup.assessments || []).find((a) => a.avgScore != null) || null;
}

export default function Report() {
  const { rollups, user } = useApp();

  const rows = useMemo(
    () => [...rollups].sort((a, b) => b.risk.score - a.risk.score),
    [rollups]
  );

  // --- Summary band ---------------------------------------------------------
  const total = rollups.length;
  const onPace = rollups.filter((r) => r.pacingStatus === 'green').length;
  const inCompliance = rollups.filter((r) => r.seenCompliant).length;
  const openInterventions = rollups.filter(
    (r) => r.intervention && r.intervention.status !== 'Complete'
  ).length;
  const overdueActions = rollups.reduce((sum, r) => sum + r.overdueActions.length, 0);

  const onPacePct = total ? Math.round((onPace / total) * 100) : 0;
  const compliancePct = total ? Math.round((inCompliance / total) * 100) : 0;

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div>
          <h2 className="section-title">Coaching Impact Report</h2>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Single-page school health. Most at-risk teachers appear first.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => window.print()}>
          Print / Export
        </button>
      </div>

      {/* Summary band */}
      <div className="grid grid--auto">
        <div className="card">
          <div className="stat">
            <span className="stat__value">{total}</span>
            <span className="stat__label">Total teachers</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value">{onPacePct}%</span>
            <span className="stat__label">On pace</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value">{compliancePct}%</span>
            <span className="stat__label">In compliance, seen within 14 days</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value">{openInterventions}</span>
            <span className="stat__label">Open interventions</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat__value" style={overdueActions ? { color: RED } : undefined}>
              {overdueActions}
            </span>
            <span className="stat__label">Overdue actions</span>
          </div>
        </div>
      </div>

      <Card title="Coaching Impact Report" count={rows.length} flush>
        <div style={{ padding: '4px 16px 0' }}>
          <p className="muted small" style={{ margin: 0 }}>
            {formatDate(isoDate())} · Prepared by: {user.name}
          </p>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="📋">No teachers on roster yet.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>
                  Risk
                  <InfoTip text={RISK_SCORE_TOOLTIP} />
                </th>
                <th className="num">
                  Days Behind
                  <InfoTip text={PACING_STATUS_TOOLTIP} />
                </th>
                <th>Last Observation</th>
                <th>Unit Test</th>
                <th className="num">Outstanding</th>
                <th>Intervention</th>
                <th>Next Recommended Support</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const test = latestCompleted(r);
                const hasOverdue = r.overdueActions.length > 0;
                const ago =
                  r.daysSinceObservation == null ? null : `(${r.daysSinceObservation}d ago)`;
                return (
                  <tr key={r.teacher.id}>
                    <td>
                      <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                        {r.teacher.name}
                      </Link>
                    </td>
                    <td>
                      <RiskBadge risk={r.risk} />
                    </td>
                    <td className="num" style={r.daysBehind > 3 ? { color: RED } : undefined}>
                      {r.daysBehind}
                    </td>
                    <td>
                      {r.lastObservation ? (
                        <>
                          {formatDate(r.lastObservation.date)}{' '}
                          {ago && <span className="faint small">{ago}</span>}
                        </>
                      ) : (
                        'Never'
                      )}
                    </td>
                    <td>
                      {test
                        ? `${test.name}, ${test.avgScore}% / ${
                            test.proficiencyPct == null ? '—' : `${test.proficiencyPct}%`
                          }`
                        : '—'}
                    </td>
                    <td
                      className="num"
                      style={hasOverdue ? { color: RED } : undefined}
                    >
                      {r.outstandingActions.length}
                    </td>
                    <td>
                      <Badge tone={r.intervention ? 'brand' : 'neutral'}>
                        {r.intervention ? r.intervention.status : 'None'}
                      </Badge>
                    </td>
                    <td className="small">{recommendedAction(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
