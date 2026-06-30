// ---------------------------------------------------------------------------
// Observations page. Lists every classroom observation, supports filtering by
// teacher and engagement, and (for the coach role) creating, editing, and
// selectively sharing observation notes with the observed teacher.
//
// Privacy model: nothing is shared with a teacher automatically. Leadership
// chooses what to share via the "Share with teacher" control in the view modal.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can } from '../lib/permissions.js';
import { formatDate, isoDate } from '../lib/dates.js';
import { Card, Badge, Empty, Field, Modal } from '../components/ui.jsx';

const ENGAGEMENT_LEVELS = ['Low', 'Medium', 'High'];
const ACTION_STATUSES = ['Open', 'In Progress', 'Complete'];

const nid = () => 'ai_' + Math.random().toString(36).slice(2, 9);

function engagementTone(level) {
  if (level === 'High') return 'green';
  if (level === 'Medium') return 'brand';
  if (level === 'Low') return 'red';
  return 'neutral';
}

function emptyForm() {
  return {
    teacherId: '',
    date: isoDate(),
    time: '',
    lessonObserved: '',
    standard: '',
    evidence: '',
    engagementLevel: 'Medium',
    evidenceOfLearning: '',
    teacherActions: '',
    studentActions: '',
    strengths: '',
    areasForGrowth: '',
    feedbackProvided: '',
    actionItems: [],
    followUpObservationDate: '',
  };
}

function newActionItem() {
  return { id: nid(), description: '', owner: '', dueDate: '', status: 'Open' };
}

export default function Observations() {
  const { observations, teachers, rollups, db, roleKey } = useApp();
  const writable = can(roleKey, 'write');

  const [teacherFilter, setTeacherFilter] = useState('all');
  const [engagementFilter, setEngagementFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [viewId, setViewId] = useState(null);

  const teacherName = useMemo(() => {
    const map = {};
    teachers.forEach((t) => {
      map[t.id] = t.name;
    });
    return map;
  }, [teachers]);

  // Compliance summary from rollups.
  const compliance = useMemo(() => {
    let seen = 0;
    let out = 0;
    rollups.forEach((r) => {
      if (r.seenCompliant) seen += 1;
      else out += 1;
    });
    return { seen, out };
  }, [rollups]);

  const rows = useMemo(() => {
    return observations
      .filter((o) => (teacherFilter === 'all' ? true : o.teacherId === teacherFilter))
      .filter((o) => (engagementFilter === 'all' ? true : o.engagementLevel === engagementFilter))
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [observations, teacherFilter, engagementFilter]);

  const viewing = viewId ? observations.find((o) => o.id === viewId) || null : null;

  // ---- form helpers -------------------------------------------------------
  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addActionItem() {
    setForm((f) => ({ ...f, actionItems: [...f.actionItems, newActionItem()] }));
  }

  function updateActionItem(id, key, value) {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.map((ai) => (ai.id === id ? { ...ai, [key]: value } : ai)),
    }));
  }

  function removeActionItem(id) {
    setForm((f) => ({ ...f, actionItems: f.actionItems.filter((ai) => ai.id !== id) }));
  }

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(obs) {
    setEditingId(obs.id);
    setForm({
      teacherId: obs.teacherId || '',
      date: obs.date || isoDate(),
      time: obs.time || '',
      lessonObserved: obs.lessonObserved || '',
      standard: obs.standard || '',
      evidence: obs.evidence || '',
      engagementLevel: obs.engagementLevel || 'Medium',
      evidenceOfLearning: obs.evidenceOfLearning || '',
      teacherActions: obs.teacherActions || '',
      studentActions: obs.studentActions || '',
      strengths: obs.strengths || '',
      areasForGrowth: obs.areasForGrowth || '',
      feedbackProvided: obs.feedbackProvided || '',
      actionItems: (obs.actionItems || []).map((ai) => ({
        id: ai.id || nid(),
        description: ai.description || '',
        owner: ai.owner || '',
        dueDate: ai.dueDate || '',
        status: ai.status || 'Open',
      })),
      followUpObservationDate: obs.followUpObservationDate || '',
    });
    setViewId(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function canSave() {
    return !!form.teacherId && !!form.date;
  }

  function save() {
    if (!canSave()) return;
    if (editingId) {
      db.update('observations', editingId, { ...form }, 'updated observation');
    } else {
      db.insert(
        'observations',
        { ...form, createdBy: 'coach', sharedWithTeacher: { whole: false, sections: [] } },
        'created observation'
      );
    }
    closeForm();
  }

  function toggleShareWhole(obs, checked) {
    db.update(
      'observations',
      obs.id,
      { sharedWithTeacher: { whole: checked, sections: [] } },
      'shared observation with teacher'
    );
  }

  // ---- render -------------------------------------------------------------
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Observations</h1>
        <p>Classroom observation notes, engagement signals, and follow-up planning.</p>
      </div>

      <div className="row row--between row--wrap">
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            aria-label="Filter by teacher"
          >
            <option value="all">All teachers</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={engagementFilter}
            onChange={(e) => setEngagementFilter(e.target.value)}
            aria-label="Filter by engagement"
          >
            <option value="all">All engagement</option>
            {ENGAGEMENT_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {writable ? (
            <button className="btn btn--primary" onClick={openNew}>
              New Observation
            </button>
          ) : (
            <span className="muted small">View only. Editing is limited to the coach role.</span>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <span className="badge badge--green">
          <span className="dot" />
          Seen within 14 days: {compliance.seen}
        </span>
        <span className="badge badge--red">
          <span className="dot" />
          Out of compliance: {compliance.out}
        </span>
      </div>

      <Card title="All observations" count={rows.length} flush>
        {rows.length === 0 ? (
          <Empty icon="👁">No observations match the current filters.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Teacher</th>
                <th>Lesson Observed</th>
                <th>Standard</th>
                <th>Engagement</th>
                <th>Follow-up</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>{formatDate(o.date)}</td>
                  <td>
                    {teacherName[o.teacherId] ? (
                      <Link className="tname" to={`/teachers/${o.teacherId}`}>
                        {teacherName[o.teacherId]}
                      </Link>
                    ) : (
                      <span className="muted">Unknown</span>
                    )}
                  </td>
                  <td>{o.lessonObserved || <span className="faint">—</span>}</td>
                  <td>{o.standard || <span className="faint">—</span>}</td>
                  <td>
                    <Badge tone={engagementTone(o.engagementLevel)}>
                      {o.engagementLevel || '—'}
                    </Badge>
                  </td>
                  <td>{formatDate(o.followUpObservationDate)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn--sm btn--ghost" onClick={() => setViewId(o.id)}>
                        View
                      </button>
                      {writable && (
                        <button className="btn btn--sm btn--ghost" onClick={() => openEdit(o)}>
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---- View modal ----------------------------------------------------- */}
      {viewing && (
        <Modal
          title="Observation detail"
          onClose={() => setViewId(null)}
          maxWidth={680}
          footer={
            <button className="btn btn--ghost" onClick={() => setViewId(null)}>
              Close
            </button>
          }
        >
          <ViewBody
            obs={viewing}
            teacherName={teacherName[viewing.teacherId]}
            writable={writable}
            onShareWhole={(checked) => toggleShareWhole(viewing, checked)}
          />
        </Modal>
      )}

      {/* ---- Form modal ----------------------------------------------------- */}
      {formOpen && (
        <Modal
          title={editingId ? 'Edit observation' : 'New observation'}
          onClose={closeForm}
          maxWidth={760}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeForm}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={save} disabled={!canSave()}>
                Save
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="section-title">Observation Information</div>
            <div className="form-row">
              <Field label="Teacher">
                <select
                  className="select"
                  value={form.teacherId}
                  onChange={(e) => setField('teacherId', e.target.value)}
                >
                  <option value="">Select a teacher</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="form-row form-row--3">
              <Field label="Date">
                <input
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                />
              </Field>
              <Field label="Time">
                <input
                  className="input"
                  type="time"
                  value={form.time}
                  onChange={(e) => setField('time', e.target.value)}
                />
              </Field>
              <Field label="Student engagement level">
                <select
                  className="select"
                  value={form.engagementLevel}
                  onChange={(e) => setField('engagementLevel', e.target.value)}
                >
                  {ENGAGEMENT_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="form-row">
              <Field label="Lesson observed">
                <input
                  className="input"
                  type="text"
                  value={form.lessonObserved}
                  onChange={(e) => setField('lessonObserved', e.target.value)}
                />
              </Field>
              <Field label="Standard taught">
                <input
                  className="input"
                  type="text"
                  value={form.standard}
                  onChange={(e) => setField('standard', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Evidence">
              <textarea
                className="textarea"
                value={form.evidence}
                onChange={(e) => setField('evidence', e.target.value)}
              />
            </Field>
            <Field label="Evidence of learning">
              <textarea
                className="textarea"
                value={form.evidenceOfLearning}
                onChange={(e) => setField('evidenceOfLearning', e.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field label="Teacher actions">
                <textarea
                  className="textarea"
                  value={form.teacherActions}
                  onChange={(e) => setField('teacherActions', e.target.value)}
                />
              </Field>
              <Field label="Student actions">
                <textarea
                  className="textarea"
                  value={form.studentActions}
                  onChange={(e) => setField('studentActions', e.target.value)}
                />
              </Field>
            </div>

            <div className="section-title">Feedback</div>
            <Field label="Strengths">
              <textarea
                className="textarea"
                value={form.strengths}
                onChange={(e) => setField('strengths', e.target.value)}
              />
            </Field>
            <Field label="Areas for growth">
              <textarea
                className="textarea"
                value={form.areasForGrowth}
                onChange={(e) => setField('areasForGrowth', e.target.value)}
              />
            </Field>
            <Field label="Feedback provided">
              <textarea
                className="textarea"
                value={form.feedbackProvided}
                onChange={(e) => setField('feedbackProvided', e.target.value)}
              />
            </Field>

            <div className="section-title">Follow Up</div>
            <Field label="Action items">
              <div className="stack">
                {form.actionItems.length === 0 && (
                  <span className="faint small">No action items yet.</span>
                )}
                {form.actionItems.map((ai) => (
                  <div key={ai.id} className="form-row form-row--3" style={{ alignItems: 'end' }}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Description"
                      value={ai.description}
                      onChange={(e) => updateActionItem(ai.id, 'description', e.target.value)}
                    />
                    <input
                      className="input"
                      type="text"
                      placeholder="Owner"
                      value={ai.owner}
                      onChange={(e) => updateActionItem(ai.id, 'owner', e.target.value)}
                    />
                    <input
                      className="input"
                      type="date"
                      value={ai.dueDate}
                      onChange={(e) => updateActionItem(ai.id, 'dueDate', e.target.value)}
                    />
                    <select
                      className="select"
                      value={ai.status}
                      onChange={(e) => updateActionItem(ai.id, 'status', e.target.value)}
                    >
                      {ACTION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => removeActionItem(ai.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div>
                  <button className="btn btn--sm" onClick={addActionItem}>
                    Add action item
                  </button>
                </div>
              </div>
            </Field>
            <div className="form-row">
              <Field label="Follow-up observation date">
                <input
                  className="input"
                  type="date"
                  value={form.followUpObservationDate}
                  onChange={(e) => setField('followUpObservationDate', e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Read-only rendering of a full observation record, plus the leadership sharing
// control when the current role can write.
function ViewBody({ obs, teacherName, writable, onShareWhole }) {
  return (
    <div className="stack">
      <div className="section-title">Observation Information</div>
      <ReadRow label="Teacher" value={teacherName} />
      <ReadRow label="Date" value={formatDate(obs.date)} />
      <ReadRow label="Time" value={obs.time} />
      <ReadRow label="Lesson observed" value={obs.lessonObserved} />
      <ReadRow label="Standard taught" value={obs.standard} />
      <ReadRow label="Student engagement level">
        <Badge tone={engagementTone(obs.engagementLevel)}>{obs.engagementLevel || '—'}</Badge>
      </ReadRow>
      <ReadRow label="Evidence" value={obs.evidence} block />
      <ReadRow label="Evidence of learning" value={obs.evidenceOfLearning} block />
      <ReadRow label="Teacher actions" value={obs.teacherActions} block />
      <ReadRow label="Student actions" value={obs.studentActions} block />

      <div className="section-title">Feedback</div>
      <ReadRow label="Strengths" value={obs.strengths} block />
      <ReadRow label="Areas for growth" value={obs.areasForGrowth} block />
      <ReadRow label="Feedback provided" value={obs.feedbackProvided} block />

      <div className="section-title">Follow Up</div>
      {(obs.actionItems || []).length === 0 ? (
        <ReadRow label="Action items" value="" />
      ) : (
        <div className="field">
          <label>Action items</label>
          <ul className="checklist">
            {obs.actionItems.map((ai) => (
              <li key={ai.id}>
                <span className={ai.status === 'Complete' ? 'check check--done' : 'check check--todo'}>
                  ✓
                </span>
                <span>
                  {ai.description || '—'}
                  {ai.owner ? ` · ${ai.owner}` : ''}
                  {ai.dueDate ? ` · due ${formatDate(ai.dueDate)}` : ''}
                  {' · '}
                  {ai.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReadRow label="Follow-up observation date" value={formatDate(obs.followUpObservationDate)} />

      {writable && (
        <>
          <div className="section-title">Share with teacher</div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={!!(obs.sharedWithTeacher && obs.sharedWithTeacher.whole)}
              onChange={(e) => onShareWhole(e.target.checked)}
            />
            <span>Share entire note</span>
          </label>
          <p className="muted small">
            Nothing is shared with the teacher automatically. Leadership chooses what to share.
          </p>
        </>
      )}
    </div>
  );
}

function ReadRow({ label, value, children, block }) {
  const content = children != null ? children : value ? value : <span className="faint">—</span>;
  return (
    <div className="field">
      <label>{label}</label>
      {block ? <p className="small" style={{ margin: 0 }}>{content}</p> : <div>{content}</div>}
    </div>
  );
}
