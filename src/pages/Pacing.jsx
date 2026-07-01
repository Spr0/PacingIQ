// ---------------------------------------------------------------------------
// Weekly pacing module. Shows every teacher's current-week pacing with a
// color-coded status and the automatic triggers the spec attaches to each
// band. The coach role can log or update a teacher's pacing for the week and
// record an exception reason; every other role sees a read-only view.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { pacingStatus } from '../lib/intelligence.js';
import { isoDate } from '../lib/dates.js';
import { Card, StatusBadge, Badge, Empty, Field, Modal, InfoTip, PACING_STATUS_TOOLTIP } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import PacingCalendarReader from '../components/PacingCalendarReader.jsx';

const EXCEPTION_REASONS = [
  'Testing disruption',
  'Assembly',
  'Field trip',
  'Weather closure',
  'Teacher absence',
  'Student remediation',
  'District mandate',
  'Custom reason',
];

const EMPTY_FORM = {
  teacherId: '',
  subject: '',
  currentUnit: '',
  currentLesson: '',
  currentStandard: '',
  daysBehind: '0',
  exceptionReason: '',
  customReason: '',
  notes: '',
};

const STATUS_LABEL = { green: 'Green', yellow: 'Yellow', red: 'Red' };

export default function Pacing() {
  const { rollups, pacingEntries, db, roleKey } = useApp();
  const writable = can(roleKey, 'write');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showCalendarReader, setShowCalendarReader] = useState(false);

  // The current week is the latest weekOf present in the data.
  const currentWeek = useMemo(() => {
    const weeks = pacingEntries.map((p) => p.weekOf).filter(Boolean).sort();
    return weeks.length ? weeks[weeks.length - 1] : isoDate();
  }, [pacingEntries]);

  // One row per teacher, or one row per subject for multi-subject teachers.
  const pacingRows = useMemo(() => {
    const rows = [];
    rollups.forEach((r) => {
      if (r.multiSubject) {
        r.pacingBySubject.forEach((sp) =>
          rows.push({
            rollup: r,
            subject: sp.subject,
            pacing: sp.pacing,
            daysBehind: sp.daysBehind,
            status: sp.status,
          })
        );
      } else {
        rows.push({
          rollup: r,
          subject: null,
          pacing: r.pacing,
          daysBehind: r.daysBehind,
          status: r.pacingStatus,
        });
      }
    });
    return rows;
  }, [rollups]);

  // Rows whose current pacing entry carries an exception reason.
  const exceptions = useMemo(
    () => pacingRows.filter((row) => row.pacing && row.pacing.exceptionReason),
    [pacingRows]
  );

  const selectedTeacher = rollups.find((r) => r.teacher.id === form.teacherId)?.teacher;
  const subjectOptions = selectedTeacher?.subjects || [];

  function openLog() {
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openUpdate(row) {
    const p = row.pacing;
    const known = p && EXCEPTION_REASONS.includes(p.exceptionReason);
    const isCustom = p && p.exceptionReason && !known;
    setForm({
      teacherId: row.rollup.teacher.id,
      subject: row.subject || '',
      currentUnit: (p && p.currentUnit) || '',
      currentLesson: (p && p.currentLesson) || '',
      currentStandard: (p && p.currentStandard) || '',
      daysBehind: p ? String(p.daysBehind ?? 0) : '0',
      exceptionReason: isCustom ? 'Custom reason' : (p && p.exceptionReason) || '',
      customReason: isCustom ? p.exceptionReason : '',
      notes: (p && p.notes) || '',
    });
    setShowModal(true);
  }

  function save() {
    if (!form.teacherId) return;
    if (subjectOptions.length > 0 && !form.subject) return;

    let exceptionReason = '';
    if (form.exceptionReason === 'Custom reason') {
      exceptionReason = form.customReason.trim();
    } else if (form.exceptionReason) {
      exceptionReason = form.exceptionReason;
    }

    const patch = {
      teacherId: form.teacherId,
      subject: form.subject || '',
      currentUnit: form.currentUnit.trim(),
      currentLesson: form.currentLesson.trim(),
      currentStandard: form.currentStandard.trim(),
      daysBehind: Math.max(0, Number(form.daysBehind) || 0),
      exceptionReason,
      notes: form.notes.trim(),
    };

    // Find this teacher's (and subject's) entry for the current week, if any.
    const existing = pacingEntries.find(
      (p) =>
        p.teacherId === form.teacherId &&
        p.weekOf === currentWeek &&
        (p.subject || '') === (form.subject || '')
    );

    if (existing) {
      db.update('pacingEntries', existing.id, patch, 'updated pacing');
    } else {
      db.insert('pacingEntries', { ...patch, weekOf: currentWeek }, 'logged pacing');
    }

    setShowModal(false);
    setForm(EMPTY_FORM);
  }

  const previewStatus = pacingStatus(Number(form.daysBehind) || 0);

  return (
    <div className="stack">
      <div className="banner banner--info">
        Green: on pace. Yellow: 1 to 3 days behind. Red: more than 3 days behind.
      </div>

      <div className="row row--between row--wrap">
        <div className="row" style={{ gap: 8 }}>
          <span className="muted small">Week of</span>
          <Badge tone="brand">This week</Badge>
        </div>
        {writable ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--ghost" onClick={() => setShowCalendarReader(true)}>
              <Icon name="sparkle" /> Import Pacing Calendar with AI
            </button>
            <button className="btn btn--primary" onClick={openLog}>
              Log Weekly Pacing
            </button>
          </div>
        ) : (
          <span className="muted small">View only. Editing is limited to the coach role.</span>
        )}
      </div>

      <Card title="Weekly Pacing" count={pacingRows.length} flush>
        {pacingRows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="📅">No teachers to pace yet.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Subject</th>
                <th>Current Unit</th>
                <th>Lesson</th>
                <th>Standard</th>
                <th className="num">
                  Days Behind
                  <InfoTip text={PACING_STATUS_TOOLTIP} />
                </th>
                <th>Status</th>
                <th>Exception</th>
                <th>Triggers</th>
                {writable && <th />}
              </tr>
            </thead>
            <tbody>
              {pacingRows.map((row) => {
                const p = row.pacing;
                const r = row.rollup;
                return (
                  <tr key={`${r.teacher.id}-${row.subject || 'main'}`}>
                    <td>
                      <Link className="tname" to={`/teachers/${r.teacher.id}`}>
                        {r.teacher.name}
                      </Link>
                    </td>
                    <td>{row.subject || '—'}</td>
                    <td>{(p && p.currentUnit) || '—'}</td>
                    <td>{(p && p.currentLesson) || '—'}</td>
                    <td>{(p && p.currentStandard) || '—'}</td>
                    <td className={`num ${row.status === 'red' ? 'risk-red' : ''}`}>
                      {row.daysBehind}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <Badge tone={p && p.exceptionReason ? 'yellow' : 'neutral'}>
                        {(p && p.exceptionReason) || '—'}
                      </Badge>
                    </td>
                    <td>
                      <Triggers status={row.status} />
                    </td>
                    {writable && (
                      <td>
                        <button className="btn btn--ghost btn--sm" onClick={() => openUpdate(row)}>
                          Update
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Exceptions This Week" count={exceptions.length} flush>
        {exceptions.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="✓">No pacing exceptions recorded this week.</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Subject</th>
                <th>Reason</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((row) => (
                <tr key={`${row.rollup.teacher.id}-${row.subject || 'main'}`}>
                  <td>
                    <Link className="tname" to={`/teachers/${row.rollup.teacher.id}`}>
                      {row.rollup.teacher.name}
                    </Link>
                  </td>
                  <td>{row.subject || '—'}</td>
                  <td>
                    <Badge tone="yellow">{row.pacing.exceptionReason}</Badge>
                  </td>
                  <td className="muted">{row.pacing.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showModal && (
        <Modal
          title={
            pacingEntries.some(
              (p) =>
                p.teacherId === form.teacherId &&
                p.weekOf === currentWeek &&
                (p.subject || '') === (form.subject || '')
            )
              ? 'Update Weekly Pacing'
              : 'Log Weekly Pacing'
          }
          onClose={() => setShowModal(false)}
          maxWidth={520}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={save}
                disabled={!form.teacherId || (subjectOptions.length > 0 && !form.subject)}
              >
                Save
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Teacher">
              <select
                className="select"
                value={form.teacherId}
                onChange={(e) => setForm({ ...form, teacherId: e.target.value, subject: '' })}
              >
                <option value="">Select a teacher</option>
                {rollups.map((r) => (
                  <option key={r.teacher.id} value={r.teacher.id}>
                    {r.teacher.name}
                  </option>
                ))}
              </select>
            </Field>

            {subjectOptions.length > 0 && (
              <Field label="Subject" hint="this teacher covers multiple subjects">
                <select
                  className="select"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                >
                  <option value="">Select a subject</option>
                  {subjectOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="form-row">
              <Field label="Current unit">
                <input
                  className="input"
                  value={form.currentUnit}
                  onChange={(e) => setForm({ ...form, currentUnit: e.target.value })}
                  placeholder="e.g. Unit 4"
                />
              </Field>
              <Field label="Current lesson">
                <input
                  className="input"
                  value={form.currentLesson}
                  onChange={(e) => setForm({ ...form, currentLesson: e.target.value })}
                  placeholder="e.g. Lesson 12"
                />
              </Field>
            </div>

            <div className="form-row">
              <Field label="Current standard">
                <input
                  className="input"
                  value={form.currentStandard}
                  onChange={(e) => setForm({ ...form, currentStandard: e.target.value })}
                  placeholder="e.g. CCSS.MATH.8.EE.7"
                />
              </Field>
              <Field label="Days behind">
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={form.daysBehind}
                  onChange={(e) => setForm({ ...form, daysBehind: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Exception reason">
              <select
                className="select"
                value={form.exceptionReason}
                onChange={(e) => setForm({ ...form, exceptionReason: e.target.value })}
              >
                <option value="">None</option>
                {EXCEPTION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </Field>

            {form.exceptionReason === 'Custom reason' && (
              <Field label="Custom reason">
                <input
                  className="input"
                  value={form.customReason}
                  onChange={(e) => setForm({ ...form, customReason: e.target.value })}
                  placeholder="Describe the exception"
                />
              </Field>
            )}

            <Field label="Observation notes">
              <textarea
                className="textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Context on this week's pacing"
                rows={3}
              />
            </Field>

            <div className="row" style={{ gap: 8 }}>
              <span className="muted small">Computed status:</span>
              <StatusBadge status={previewStatus} label={STATUS_LABEL[previewStatus]} />
            </div>
          </div>
        </Modal>
      )}

      {showCalendarReader && (
        <PacingCalendarReader onClose={() => setShowCalendarReader(false)} />
      )}
    </div>
  );
}

// The spec attaches automatic triggers to each pacing band. Red fires the full
// escalation set; yellow fires an email alert only; green fires nothing.
function Triggers({ status }) {
  if (status === 'red') {
    return (
      <div className="row" style={{ gap: 4 }}>
        <Badge tone="red">Intervention</Badge>
        <Badge tone="red">Coach meeting</Badge>
        <Badge tone="red">Email alert</Badge>
      </div>
    );
  }
  if (status === 'yellow') {
    return <Badge tone="yellow">Email alert</Badge>;
  }
  return <span className="muted">—</span>;
}
