// ---------------------------------------------------------------------------
// Read-only audit trail. Every login, record edit, observation, coaching note,
// intervention, and scheduling action is appended to the audit log. This view
// is visible to all roles and supports a simple text filter. Nothing here
// mutates state.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Card, Empty } from '../components/ui.jsx';

export default function AuditLog() {
  const { auditLog } = useApp();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const sorted = [...auditLog].sort((a, b) =>
      (b.timestamp || '').localeCompare(a.timestamp || '')
    );
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((e) => {
      const hay = `${e.actor || ''} ${e.action || ''} ${e.detail || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [auditLog, query]);

  return (
    <div className="stack">
      <div className="page-head">
        <p className="muted small">
          Login activity, record edits, observations, coaching notes, interventions, and scheduling
          are tracked here.
        </p>
      </div>

      <div className="row row--between row--wrap">
        <input
          className="input"
          placeholder="Filter by actor, action, or detail"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 280 }}
        />
      </div>

      <Card title="Activity" count={rows.length} flush>
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="📜">
              {auditLog.length === 0 ? 'No activity recorded yet.' : 'No entries match the filter.'}
            </Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id || i}>
                  <td className="mono small">
                    {e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}
                  </td>
                  <td>{e.actor || 'system'}</td>
                  <td>{e.action || '—'}</td>
                  <td className="muted">{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
