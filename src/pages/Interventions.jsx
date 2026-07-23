// ---------------------------------------------------------------------------
// Intervention workflow. Every Red-status teacher needs an intervention case
// that carries the five required steps from the spec. The coach role drives the
// workflow (toggle steps, manage the action plan, complete the case); the
// leadership-review step is reserved for principal / AP (or the coach). Other
// roles see a read-only view.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { isOverdue } from '../lib/intelligence.js';
import { formatDate, isoDate, daysUntil } from '../lib/dates.js';
import { Card, Badge, Empty, Field, Modal } from '../components/ui.jsx';

const REQUIREMENTS = [
  { key: 'caseCreated', label: 'Create intervention case' },
  { key: 'actionPlan', label: 'Create action plan' },
  { key: 'coachingMeetingScheduled', label: 'Schedule coaching meeting' },
  { key: 'followUpObservation', label: 'Require follow-up observation' },
  { key: 'leadershipReview', label: 'Leadership review' },
];

const ACTION_STATUSES = ['Open', 'In Progress', 'Complete'];

const STATUS_TONE = {
  Open: 'neutral',
  'In Progress': 'yellow',
  Complete: 'green',
  Overdue: 'red',
};

const STATUS_ORDER = { Open: 0, 'In Progress': 0, Overdue: 0, Complete: 1 };

const EMPTY_FORM = {
  teacherId: '',
  concern: '',
  rootCause: '',
  responsiblePerson: 'Coach',
  dueDate: '',
  followUpDate: '',
};

export default function Interventions() {
  const { rollups, interventions, db, roleKey } = useApp();
  const writable = can(roleKey, 'write');
  const canReview = can(roleKey, 'leadershipReview') || writable;

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Shared banner for the inline, no-modal actions below (toggling a
  // requirement, changing an action's status, completing a case) -- there's
  // no per-row toast in this app, so a failed write surfaces here instead of
  // just doing nothing with no explanation.
  const [actionError, setActionError] = useState(null);

  const teacherName = useMemo(() => {
    const map = {};
    rollups.forEach((r) => {
      map[r.teacher.id] = r.teacher.name;
    });
    return map;
  }, [rollups]);

  // Red-status teachers with no active (non-complete) intervention.
  const redNeedingCase = useMemo(
    () => rollups.filter((r) => r.pacingStatus === 'red' && !r.intervention),
    [rollups]
  );

  // Red-status teachers preferred at the top of the new-intervention picker.
  const redIds = useMemo(
    () => new Set(rollups.filter((r) => r.pacingStatus === 'red').map((r) => r.teacher.id)),
    [rollups]
  );

  const sorted = useMemo(() => {
    return [...interventions].sort((a, b) => {
      const oa = STATUS_ORDER[a.status] ?? 0;
      const ob = STATUS_ORDER[b.status] ?? 0;
      if (oa !== ob) return oa - ob;
      return (b.openedDate || '').localeCompare(a.openedDate || '');
    });
  }, [interventions]);

  function openNew() {
    const firstRed = rollups.find((r) => r.pacingStatus === 'red' && !r.intervention);
    setForm({ ...EMPTY_FORM, teacherId: firstRed ? firstRed.teacher.id : '' });
    setSaveError(null);
    setShowModal(true);
  }

  // Awaited so a failed write surfaces as an error the user can see and
  // leaves the form open with their input intact, instead of the modal
  // closing as if it saved while the case silently never landed.
  async function createIntervention() {
    if (!form.teacherId || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await db.insert(
        'interventions',
        {
          teacherId: form.teacherId,
          status: 'In Progress',
          openedDate: isoDate(),
          concern: form.concern.trim(),
          rootCause: form.rootCause.trim(),
          responsiblePerson: form.responsiblePerson.trim() || 'Coach',
          dueDate: form.dueDate || '',
          followUpDate: form.followUpDate || '',
          evidenceOfCompletion: '',
          requirements: {
            caseCreated: true,
            actionPlan: false,
            coachingMeetingScheduled: false,
            followUpObservation: false,
            leadershipReview: false,
          },
          agreedActions: [],
        },
        'opened intervention'
      );
      setShowModal(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setSaveError(err.message || 'Failed to open this intervention. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // These three are inline, no-modal actions (a checkbox-like toggle, a
  // status dropdown, a button) rather than a form with something to keep
  // open on failure -- so a failed write is surfaced via the shared
  // actionError banner instead of a per-field error.
  async function toggleRequirement(iv, key) {
    const requirements = { ...iv.requirements, [key]: !iv.requirements[key] };
    setActionError(null);
    try {
      await db.update('interventions', iv.id, { requirements }, 'updated intervention');
    } catch (err) {
      setActionError(err.message || 'Failed to update that requirement. Please try again.');
    }
  }

  async function changeActionStatus(iv, actionId, status) {
    const agreedActions = (iv.agreedActions || []).map((a) =>
      a.id === actionId ? { ...a, status } : a
    );
    setActionError(null);
    try {
      await db.update('interventions', iv.id, { agreedActions }, 'updated action plan');
    } catch (err) {
      setActionError(err.message || 'Failed to update that action. Please try again.');
    }
  }

  async function completeIntervention(iv) {
    setActionError(null);
    try {
      await db.update('interventions', iv.id, { status: 'Complete' }, 'completed intervention');
    } catch (err) {
      setActionError(err.message || 'Failed to complete this intervention. Please try again.');
    }
  }

  function allRequirementsMet(iv) {
    return REQUIREMENTS.every((r) => iv.requirements && iv.requirements[r.key]);
  }

  return (
    <div className="stack">
      {redNeedingCase.length > 0 && (
        <div className="banner banner--danger">
          {redNeedingCase.length} teacher(s) at Red status need an intervention case.{' '}
          {redNeedingCase.map((r) => r.teacher.name).join(', ')}.
        </div>
      )}

      {actionError && <div className="banner banner--danger">{actionError}</div>}

      <div className="row row--between row--wrap">
        <span className="muted small">
          Teacher remains at Red status until all intervention requirements are complete.
        </span>
        {writable ? (
          <button className="btn btn--primary" onClick={openNew}>
            New Intervention
          </button>
        ) : (
          <span className="muted small">View only. Editing is limited to the coach role.</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <Card title="Interventions" count={0}>
          <Empty icon="🗂️">No intervention cases yet.</Empty>
        </Card>
      ) : (
        sorted.map((iv) => {
          const overdueDue =
            iv.dueDate && iv.status !== 'Complete' && (daysUntil(iv.dueDate) ?? 0) < 0;
          const statusTone =
            iv.status === 'Complete'
              ? 'green'
              : iv.status === 'In Progress'
              ? 'yellow'
              : iv.status === 'Overdue'
              ? 'red'
              : 'neutral';
          const allMet = allRequirementsMet(iv);
          return (
            <section className="card" key={iv.id}>
              <div className="card__head">
                <div className="row" style={{ gap: 8 }}>
                  <h3>
                    <Link className="tname" to={`/teachers/${iv.teacherId}`}>
                      {teacherName[iv.teacherId] || 'Unknown teacher'}
                    </Link>
                  </h3>
                  <Badge tone={statusTone}>{iv.status}</Badge>
                </div>
                {writable && (
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={!allMet || iv.status === 'Complete'}
                    onClick={() => completeIntervention(iv)}
                  >
                    Complete intervention
                  </button>
                )}
              </div>
              <div className="card__body stack">
                <div className="grid grid--2">
                  <div>
                    <div className="muted small">Concern</div>
                    <div>{iv.concern || '—'}</div>
                  </div>
                  <div>
                    <div className="muted small">Root cause</div>
                    <div>{iv.rootCause || '—'}</div>
                  </div>
                  <div>
                    <div className="muted small">Responsible person</div>
                    <div>{iv.responsiblePerson || '—'}</div>
                  </div>
                  <div>
                    <div className="muted small">Due date</div>
                    <div className={overdueDue ? 'risk-red' : undefined}>
                      {formatDate(iv.dueDate)}
                    </div>
                  </div>
                  <div>
                    <div className="muted small">Follow-up date</div>
                    <div>{formatDate(iv.followUpDate)}</div>
                  </div>
                </div>

                <div>
                  <div className="section-title">Required steps</div>
                  <ul className="checklist">
                    {REQUIREMENTS.map((req) => {
                      const done = !!(iv.requirements && iv.requirements[req.key]);
                      const gated = req.key === 'leadershipReview' ? canReview : writable;
                      const content = (
                        <>
                          <span className={`check ${done ? 'check--done' : 'check--todo'}`}>✓</span>
                          {req.label}
                        </>
                      );
                      return (
                        <li key={req.key}>
                          {gated ? (
                            <button
                              className="linklike"
                              onClick={() => toggleRequirement(iv, req.key)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                font: 'inherit',
                                color: 'inherit',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div>
                  <div className="section-title">Agreed action plan</div>
                  {(iv.agreedActions || []).length === 0 ? (
                    <div className="muted small">No agreed actions recorded.</div>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Owner</th>
                          <th>Due</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {iv.agreedActions.map((a) => {
                          const over = isOverdue(a);
                          return (
                            <tr key={a.id}>
                              <td>{a.description}</td>
                              <td>{a.owner || '—'}</td>
                              <td className={over ? 'risk-red' : undefined}>
                                {formatDate(a.dueDate)}
                              </td>
                              <td>
                                {writable ? (
                                  <select
                                    className="select"
                                    value={a.status}
                                    onChange={(e) => changeActionStatus(iv, a.id, e.target.value)}
                                  >
                                    {ACTION_STATUSES.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <Badge tone={STATUS_TONE[over ? 'Overdue' : a.status] || 'neutral'}>
                                    {a.status}
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}

      {showModal && (
        <Modal
          title="New Intervention"
          onClose={() => setShowModal(false)}
          maxWidth={520}
          footer={
            <>
              {saveError && (
                <p className="small" style={{ color: 'var(--red-600)', margin: '0 auto 0 0' }}>
                  {saveError}
                </p>
              )}
              <button className="btn btn--ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={createIntervention}
                disabled={!form.teacherId || saving}
              >
                {saving ? 'Saving…' : 'Open case'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Teacher">
              <select
                className="select"
                value={form.teacherId}
                onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
              >
                <option value="">Select a teacher</option>
                {rollups
                  .slice()
                  .sort((a, b) => {
                    const ra = redIds.has(a.teacher.id) ? 0 : 1;
                    const rb = redIds.has(b.teacher.id) ? 0 : 1;
                    if (ra !== rb) return ra - rb;
                    return a.teacher.name.localeCompare(b.teacher.name);
                  })
                  .map((r) => (
                    <option key={r.teacher.id} value={r.teacher.id}>
                      {r.teacher.name}
                      {redIds.has(r.teacher.id) ? ' (Red)' : ''}
                    </option>
                  ))}
              </select>
            </Field>

            <Field label="Concern">
              <textarea
                className="textarea"
                value={form.concern}
                onChange={(e) => setForm({ ...form, concern: e.target.value })}
                placeholder="What is the pacing or instructional concern?"
                rows={2}
              />
            </Field>

            <Field label="Root cause">
              <textarea
                className="textarea"
                value={form.rootCause}
                onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
                placeholder="What is driving the concern?"
                rows={2}
              />
            </Field>

            <div className="form-row">
              <Field label="Responsible person">
                <input
                  className="input"
                  value={form.responsiblePerson}
                  onChange={(e) => setForm({ ...form, responsiblePerson: e.target.value })}
                />
              </Field>
            </div>

            <div className="form-row">
              <Field label="Due date">
                <input
                  className="input"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </Field>
              <Field label="Follow-up date">
                <input
                  className="input"
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
