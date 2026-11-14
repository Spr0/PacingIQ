// ---------------------------------------------------------------------------
// Log visits: record observations for many teachers in one pass.
//
// Built for catching up. The coach fills in what was the same across visits
// once, at the top, then changes only the rows where a visit was different.
// Every row inherits the shared values live until it is edited; an edited cell
// is marked so it is obvious which teachers differ.
//
// Reached from the Teachers roster (select teachers, "Log visits") with the
// chosen ids in ?teachers=. More teachers can be added here too.
//
// Saving is ONE insert for the whole batch, so it either all lands or none of
// it does, and nothing says "saved" until that request has resolved. Undo
// deletes exactly the rows this save created (by id), which is coach-only
// because delete is coach-only in RLS (migrations/002).
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { can, canDeleteRecord } from '../lib/permissions.js';
import { formatDate, isoDate } from '../lib/dates.js';
import { isRealObservation } from '../lib/intelligence.js';
import {
  emptyShared,
  newRow,
  isOverridden,
  resolvedValue,
  rowsMissingDate,
  duplicateTeacherIds,
  buildBatchRecords,
} from '../lib/batchObservations.js';
import { Card, Empty, Field } from '../components/ui.jsx';

const nid = () => 'ai_' + Math.random().toString(36).slice(2, 9);

// Long-text fields, shown in the shared panel and in a row's expanded detail.
const LONG_FIELDS = [
  { key: 'evidenceOfLearning', label: 'Evidence of learning' },
  { key: 'teacherActions', label: 'Teacher actions' },
  { key: 'studentActions', label: 'Student actions' },
  { key: 'strengths', label: 'Strengths' },
  { key: 'areasForGrowth', label: 'Areas for growth' },
  { key: 'feedbackProvided', label: 'Feedback provided' },
];

export default function LogVisits() {
  const { teachers, observations, db, roleKey, user } = useApp();
  const writable = can(roleKey, 'write');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const teacherById = useMemo(() => {
    const map = {};
    teachers.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [teachers]);

  // Ids from the roster selection, in the order they were listed there.
  // Unknown ids (a teacher deleted since the link was made) are dropped.
  const [rows, setRows] = useState(() => {
    const ids = (searchParams.get('teachers') || '').split(',').filter(Boolean);
    const seen = new Set();
    return ids
      .filter((id) => teacherById[id] && !seen.has(id) && seen.add(id))
      .map(newRow);
  });
  const [shared, setShared] = useState(() => emptyShared(isoDate()));
  const [expanded, setExpanded] = useState(() => new Set());
  // The feedback fields, action items and follow-up date fold away by default
  // so the teacher list is on screen without scrolling past six empty boxes.
  const [moreShared, setMoreShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // After a successful save: the rows that were created, for the summary and Undo.
  const [saved, setSaved] = useState(null);
  const [undoing, setUndoing] = useState(false);

  const missingDate = rowsMissingDate(shared, rows);
  const dupes = useMemo(
    () => duplicateTeacherIds(shared, rows, observations, isRealObservation),
    [shared, rows, observations]
  );
  const available = teachers
    .filter((t) => !rows.some((r) => r.teacherId === t.id))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // ---- shared panel -------------------------------------------------------
  function setSharedField(key, value) {
    setShared((s) => ({ ...s, [key]: value }));
  }
  function addSharedItem() {
    setShared((s) => ({
      ...s,
      actionItems: [...s.actionItems, { id: nid(), description: '', owner: '', dueDate: '' }],
    }));
  }
  function updateSharedItem(id, key, value) {
    setShared((s) => ({
      ...s,
      actionItems: s.actionItems.map((ai) => (ai.id === id ? { ...ai, [key]: value } : ai)),
    }));
  }
  function removeSharedItem(id) {
    setShared((s) => ({ ...s, actionItems: s.actionItems.filter((ai) => ai.id !== id) }));
  }

  // ---- rows -------------------------------------------------------------
  function setRowField(teacherId, key, value) {
    setRows((rs) =>
      rs.map((r) => (r.teacherId === teacherId ? { ...r, overrides: { ...r.overrides, [key]: value } } : r))
    );
  }
  function resetRow(teacherId) {
    setRows((rs) => rs.map((r) => (r.teacherId === teacherId ? { ...r, overrides: {} } : r)));
  }
  function removeRow(teacherId) {
    setRows((rs) => rs.filter((r) => r.teacherId !== teacherId));
  }
  function addRow(teacherId) {
    if (!teacherId) return;
    setRows((rs) => (rs.some((r) => r.teacherId === teacherId) ? rs : [...rs, newRow(teacherId)]));
  }
  function toggleExpanded(teacherId) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  }

  // ---- save / undo -------------------------------------------------------
  const canSave = writable && rows.length > 0 && missingDate.length === 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const records = buildBatchRecords(shared, rows, {
        createdBy: user.name,
        makeId: () => crypto.randomUUID(),
        makeItemId: nid,
      });
      const created = await db.insertMany('observations', records, 'logged observations in batch');
      setSaved(created);
    } catch (err) {
      setError(err.message || 'These observations did not save. Nothing was recorded; please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Back to the filled-in batch, so a mistake can be fixed and saved again.
  async function undo() {
    if (!saved || undoing) return;
    setUndoing(true);
    setError(null);
    try {
      const ids = saved.map((o) => o.id);
      const removed = await db.removeMany('observations', ids, 'undid batch of observations');
      if (removed < ids.length) {
        setError(
          `Only ${removed} of ${ids.length} observations could be removed. Check the Observations page for the rest.`
        );
      } else {
        setSaved(null);
      }
    } catch (err) {
      setError(err.message || 'Undo did not go through. The observations are still saved.');
    } finally {
      setUndoing(false);
    }
  }

  function startOver() {
    setRows([]);
    setShared(emptyShared(isoDate()));
    setExpanded(new Set());
    setSaved(null);
    setError(null);
  }

  // ---- render -----------------------------------------------------------
  if (!writable) {
    return (
      <div className="stack">
        <div className="page-head">
          <h1>Log visits</h1>
        </div>
        <Empty icon="🔒">Your role can view observations but not create them.</Empty>
      </div>
    );
  }

  if (saved) {
    const sorted = saved
      .slice()
      .sort((a, b) => (teacherById[a.teacherId]?.name || '').localeCompare(teacherById[b.teacherId]?.name || ''));
    return (
      <div className="stack">
        <div className="page-head">
          <h1>Log visits</h1>
        </div>
        <div className="banner banner--info">
          Logged {saved.length} observation{saved.length === 1 ? '' : 's'}.
        </div>
        {error && <div className="banner banner--danger">{error}</div>}
        <Card title="Saved" count={saved.length} flush>
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Date</th>
                <th>Lesson observed</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link className="tname" to={`/teachers/${o.teacherId}`}>
                      {teacherById[o.teacherId]?.name || 'Unknown'}
                    </Link>
                  </td>
                  <td>{formatDate(o.date)}</td>
                  <td>{o.lessonObserved || <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="row row--wrap" style={{ gap: 8 }}>
          {canDeleteRecord(roleKey) && (
            <button className="btn" onClick={undo} disabled={undoing}>
              {undoing ? 'Undoing…' : 'Undo and edit'}
            </button>
          )}
          <button className="btn" onClick={startOver}>
            Log more visits
          </button>
          <button className="btn" onClick={() => navigate('/observations')}>
            View observations
          </button>
          <button className="btn btn--primary" onClick={() => navigate('/teachers')}>
            Back to Teachers
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Log visits</h1>
          <p>
            Fill in what was the same once. Every teacher below starts with those values; change any cell
            where a visit was different.
          </p>
        </div>
      </div>

      <Card title="Same for every visit">
        <div className="stack">
          <div className="form-row">
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={shared.date}
                onChange={(e) => setSharedField('date', e.target.value)}
              />
            </Field>
            <Field label="Time">
              <input
                className="input"
                type="time"
                value={shared.time}
                onChange={(e) => setSharedField('time', e.target.value)}
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Lesson observed">
              <input
                className="input"
                type="text"
                value={shared.lessonObserved}
                onChange={(e) => setSharedField('lessonObserved', e.target.value)}
              />
            </Field>
            <Field label="Standard taught">
              <input
                className="input"
                type="text"
                value={shared.standard}
                onChange={(e) => setSharedField('standard', e.target.value)}
              />
            </Field>
          </div>
          <div>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => setMoreShared((v) => !v)}
              aria-expanded={moreShared}
            >
              {moreShared ? 'Hide feedback and follow-up' : 'Add shared feedback, action items, or follow-up'}
              {!moreShared && sharedExtrasCount(shared) > 0 && ` (${sharedExtrasCount(shared)} filled)`}
            </button>
          </div>
          {moreShared && (
          <>
          <div className="form-row">
            {LONG_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <textarea
                  className="textarea batch-textarea"
                  value={shared[f.key]}
                  onChange={(e) => setSharedField(f.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Field label="Action items" hint="added to every teacher's observation as its own item">
            <div className="stack">
              {shared.actionItems.map((ai) => (
                <div key={ai.id} className="batch-item-row">
                  <input
                    className="input"
                    type="text"
                    placeholder="Description"
                    value={ai.description}
                    onChange={(e) => updateSharedItem(ai.id, 'description', e.target.value)}
                  />
                  <input
                    className="input"
                    type="text"
                    placeholder="Owner"
                    value={ai.owner}
                    onChange={(e) => updateSharedItem(ai.id, 'owner', e.target.value)}
                  />
                  <input
                    className="input"
                    type="date"
                    value={ai.dueDate}
                    onChange={(e) => updateSharedItem(ai.id, 'dueDate', e.target.value)}
                  />
                  <button className="btn btn--sm btn--ghost" onClick={() => removeSharedItem(ai.id)}>
                    Remove
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn--sm" onClick={addSharedItem}>
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
                value={shared.followUpObservationDate}
                onChange={(e) => setSharedField('followUpObservationDate', e.target.value)}
              />
            </Field>
          </div>
          </>
          )}
        </div>
      </Card>

      <Card title="Teachers" count={rows.length} flush>
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty icon="👥">
              No teachers yet. Add them below, or select them on the{' '}
              <Link to="/teachers">Teachers</Link> page.
            </Empty>
          </div>
        ) : (
          <div className="draft-scroll">
            <table className="table table--batch">
              <colgroup>
                <col style={{ width: 200 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 120 }} />
                <col />
                <col />
                <col style={{ width: 170 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Lesson observed</th>
                  <th>Standard</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = teacherById[r.teacherId];
                  const open = expanded.has(r.teacherId);
                  const changed = Object.keys(r.overrides).length;
                  const cell = (key, type = 'text') => (
                    <input
                      className={`input ${isOverridden(r, key) ? 'batch-override' : 'batch-inherit'}`}
                      type={type}
                      value={resolvedValue(shared, r, key)}
                      onChange={(e) => setRowField(r.teacherId, key, e.target.value)}
                      aria-label={`${fieldLabel(key)} for ${t?.name || 'teacher'}`}
                    />
                  );
                  return [
                    <tr key={r.teacherId}>
                      <td>
                        <div className="tname">{t?.name || 'Unknown'}</div>
                        {!resolvedValue(shared, r, 'date') && (
                          <div className="small" style={{ color: 'var(--red-text)' }}>Needs a date</div>
                        )}
                        {dupes.has(r.teacherId) && (
                          <div className="small" style={{ color: 'var(--amber-text)' }}>
                            Already has a visit on this date
                          </div>
                        )}
                      </td>
                      <td>{cell('date', 'date')}</td>
                      <td>{cell('time', 'time')}</td>
                      <td>{cell('lessonObserved')}</td>
                      <td>{cell('standard')}</td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => toggleExpanded(r.teacherId)}
                            aria-expanded={open}
                          >
                            {open ? 'Less' : 'More'}
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => removeRow(r.teacherId)}
                            aria-label={`Remove ${t?.name || 'teacher'}`}
                          >
                            ✕
                          </button>
                        </div>
                        {changed > 0 && (
                          <div className="small" style={{ textAlign: 'right' }}>
                            <span className="muted">{changed} changed · </span>
                            <button className="linklike" onClick={() => resetRow(r.teacherId)}>
                              Reset
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>,
                    open && (
                      <tr key={`${r.teacherId}-more`} className="batch-detail">
                        <td colSpan={6}>
                          <div className="form-row">
                            {LONG_FIELDS.map((f) => (
                              <Field key={f.key} label={f.label}>
                                <textarea
                                  className={`textarea batch-textarea ${isOverridden(r, f.key) ? 'batch-override' : 'batch-inherit'}`}
                                  value={resolvedValue(shared, r, f.key)}
                                  onChange={(e) => setRowField(r.teacherId, f.key, e.target.value)}
                                />
                              </Field>
                            ))}
                            <Field label="Follow-up observation date">
                              {cell('followUpObservationDate', 'date')}
                            </Field>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {available.length > 0 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
            <select
              className="select"
              value=""
              onChange={(e) => addRow(e.target.value)}
              aria-label="Add a teacher"
            >
              <option value="">Add a teacher…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {error && <div className="banner banner--danger">{error}</div>}

      <div className="batch-bar">
        <span className="muted small">
          {missingDate.length > 0
            ? `${missingDate.length} teacher${missingDate.length === 1 ? '' : 's'} still need${missingDate.length === 1 ? 's' : ''} a date.`
            : 'Grey text comes from the shared values; dark text was changed for that teacher.'}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--ghost" onClick={() => navigate('/teachers')}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={!canSave}>
            {saving
              ? 'Saving…'
              : `Save ${rows.length} observation${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// How many of the folded-away shared fields hold something, so a collapsed
// panel never hides values that are about to be saved to every teacher.
function sharedExtrasCount(shared) {
  const text = LONG_FIELDS.filter((f) => (shared[f.key] || '').trim()).length;
  const items = shared.actionItems.filter((ai) => (ai.description || '').trim()).length;
  return text + items + (shared.followUpObservationDate ? 1 : 0);
}

function fieldLabel(key) {
  return (
    {
      date: 'Date',
      time: 'Time',
      lessonObserved: 'Lesson observed',
      standard: 'Standard',
      followUpObservationDate: 'Follow-up date',
    }[key] || key
  );
}
