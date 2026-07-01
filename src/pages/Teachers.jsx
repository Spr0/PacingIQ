// ---------------------------------------------------------------------------
// Teachers roster. A filterable table of every teacher rollup with pacing,
// last-seen compliance, open actions, and risk. The coach role can add new
// teachers; every other role sees a read-only view.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { pacingStatus } from '../lib/intelligence.js';
import { formatDate } from '../lib/dates.js';
import {
  Card,
  StatusBadge,
  RiskBadge,
  Badge,
  Empty,
  Field,
  Modal,
  InfoTip,
  RISK_SCORE_TOOLTIP,
  PACING_STATUS_TOOLTIP,
} from '../components/ui.jsx';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'behind', label: 'Behind pace' },
  { value: 'red', label: 'Red risk' },
  { value: 'unseen', label: 'Not seen 14d' },
];

const EMPTY_FORM = { name: '', subject: '', subjects: '', gradeLevel: '', assignedAdmin: '' };

export default function Teachers() {
  const { rollups, db, roleKey } = useApp();
  const writable = can(roleKey, 'write');

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      const t = r.teacher;
      if (q) {
        const hay = `${t.name} ${t.subject}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === 'behind' && r.daysBehind <= 0) return false;
      if (statusFilter === 'red' && r.risk.band !== 'red') return false;
      if (statusFilter === 'unseen' && r.seenCompliant) return false;
      return true;
    });
  }, [rollups, query, statusFilter]);

  function openModal() {
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function save() {
    const name = form.name.trim();
    if (!name) return;
    const subjects = form.subjects
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const record = {
      name,
      subject: form.subject.trim() || (subjects.length ? subjects.join(', ') : ''),
      gradeLevel: form.gradeLevel.trim(),
      assignedAdmin: form.assignedAdmin.trim(),
    };
    if (subjects.length > 1) record.subjects = subjects;
    db.insert('teachers', record, 'added teacher');
    setShowModal(false);
    setForm(EMPTY_FORM);
  }

  return (
    <div className="stack">
      <div className="row row--between row--wrap">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Search by name or subject"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {writable ? (
          <button className="btn btn--primary" onClick={openModal}>
            New Teacher
          </button>
        ) : (
          <span className="muted small">View only. Editing is limited to the coach role.</span>
        )}
      </div>

      <Card title="Teachers" count={filtered.length} flush>
        {filtered.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="🔍">No teachers match the current filters.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Subject</th>
                <th>Grade</th>
                <th>Admin</th>
                <th>
                  Pacing
                  <InfoTip text={PACING_STATUS_TOOLTIP} />
                </th>
                <th>Last Seen</th>
                <th className="num">Open Actions</th>
                <th>
                  Risk
                  <InfoTip text={RISK_SCORE_TOOLTIP} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const t = r.teacher;
                const overdue = r.overdueActions.length > 0;
                const pacingLabel =
                  r.daysBehind > 0 ? `${r.daysBehind}d behind` : null;
                return (
                  <tr key={t.id}>
                    <td>
                      <Link className="tname" to={`/teachers/${t.id}`}>
                        {t.name}
                      </Link>
                    </td>
                    <td>{t.subject || '—'}</td>
                    <td>{t.gradeLevel || '—'}</td>
                    <td>{t.assignedAdmin || '—'}</td>
                    <td>
                      {r.multiSubject ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {r.pacingBySubject.map((sp) => (
                            <StatusBadge
                              key={sp.subject}
                              status={sp.status}
                              label={`${sp.subject} · ${sp.daysBehind > 0 ? `${sp.daysBehind}d behind` : 'On pace'}`}
                            />
                          ))}
                        </div>
                      ) : (
                        <StatusBadge
                          status={r.pacingStatus}
                          label={pacingLabel ? `${capitalize(r.pacingStatus)} ${pacingLabel}` : undefined}
                        />
                      )}
                    </td>
                    <td style={r.seenCompliant ? undefined : { color: 'var(--red)' }}>
                      {r.lastObservation ? formatDate(r.lastObservation.date) : 'Never'}
                    </td>
                    <td className="num">
                      {r.outstandingActions.length === 0 ? (
                        '0'
                      ) : overdue ? (
                        <Badge tone="red">{r.outstandingActions.length}</Badge>
                      ) : (
                        r.outstandingActions.length
                      )}
                    </td>
                    <td>
                      <RiskBadge risk={r.risk} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {showModal && (
        <Modal
          title="New Teacher"
          onClose={() => setShowModal(false)}
          maxWidth={480}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={save} disabled={!form.name.trim()}>
                Save
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Name">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Teacher name"
                autoFocus
              />
            </Field>
            <Field label="Subject">
              <input
                className="input"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="e.g. Algebra I"
              />
            </Field>
            <Field
              label="Subjects taught"
              hint="comma separated, for elementary/multi-subject teachers only"
            >
              <input
                className="input"
                value={form.subjects}
                onChange={(e) => setForm({ ...form, subjects: e.target.value })}
                placeholder="e.g. ELA, Math"
              />
            </Field>
            <div className="form-row">
              <Field label="Grade level">
                <input
                  className="input"
                  value={form.gradeLevel}
                  onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })}
                  placeholder="e.g. 9"
                />
              </Field>
              <Field label="Assigned admin">
                <input
                  className="input"
                  value={form.assignedAdmin}
                  onChange={(e) => setForm({ ...form, assignedAdmin: e.target.value })}
                  placeholder="e.g. AP Brooks"
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
