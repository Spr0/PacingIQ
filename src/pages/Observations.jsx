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
import {
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
  uploadAttachment,
  deleteAttachment,
  attachmentUrl,
} from '../lib/attachments.js';
import { Card, Badge, Empty, Field, Modal, SortHeader } from '../components/ui.jsx';

const ENGAGEMENT_LEVELS = ['Low', 'Medium', 'High'];
const ACTION_STATUSES = ['Open', 'In Progress', 'Complete'];

// Rank engagement so the column sorts by intensity (Low -> High), not
// alphabetically. Missing values sort below any set level.
const ENGAGEMENT_RANK = { Low: 1, Medium: 2, High: 3 };

// The direction a column starts in the first time it is clicked: dates newest
// first, teachers A to Z, engagement highest first.
const DEFAULT_SORT_DIR = { date: 'desc', teacher: 'asc', engagement: 'desc', followUp: 'asc' };

// The units of an observation the coach can selectively share with the observed
// teacher. Leadership can share the whole note (stored as `whole`) or any subset
// of these (stored as `sections`). The three feedback fields are individually
// shareable so leadership can release "selected feedback" per the privacy model.
const SHAREABLE_SECTIONS = [
  { key: 'observation', label: 'Observation Information', group: 'section' },
  { key: 'strengths', label: 'Strengths', group: 'feedback' },
  { key: 'growth', label: 'Areas for growth', group: 'feedback' },
  { key: 'feedback', label: 'Feedback provided', group: 'feedback' },
  { key: 'followUp', label: 'Follow-up and action items', group: 'section' },
  { key: 'attachments', label: 'Attachments', group: 'section' },
];

const nid = () => 'ai_' + Math.random().toString(36).slice(2, 9);

function engagementTone(level) {
  if (level === 'High') return 'green';
  if (level === 'Medium') return 'brand';
  if (level === 'Low') return 'red';
  return 'neutral';
}

// Teachers have no email field in the demo data, so derive a plausible address
// from the name. The composer's To field is editable, so this is only a default.
function deriveTeacherEmail(name) {
  const parts = (name || '').trim().split(/\s+/);
  const first = (parts[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  const last = (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
  const handle = [first, last].filter(Boolean).join('.') || 'teacher';
  return `${handle}@sierrarams.org`;
}

// Build the default email body from an observation and the teacher's pacing
// rollup: pacing, observation feedback, action steps, and the follow-up date.
function buildTeacherEmail(obs, rollup, teacher, coachName) {
  const first = (teacher.name || '').trim().split(/\s+/)[0] || 'there';
  const lines = [`Hi ${first},`, ''];
  lines.push(
    `Thank you for having me in your ${teacher.subject || 'class'}. Here is a summary from our observation on ${formatDate(obs.date)} and where pacing stands.`
  );

  // Pacing info, per subject for multi-subject teachers.
  if (rollup) {
    lines.push('', 'Pacing:');
    const subjects = rollup.multiSubject && rollup.pacingBySubject ? rollup.pacingBySubject : null;
    if (subjects && subjects.length) {
      subjects.forEach((sp) => {
        const where = sp.pacing && sp.pacing.currentUnit ? ` in ${sp.pacing.currentUnit}` : '';
        lines.push(`- ${sp.subject}: ${sp.daysBehind > 0 ? `${sp.daysBehind} day(s) behind` : 'on pace'}${where}.`);
      });
    } else {
      const p = rollup.pacing;
      const where = p && p.currentUnit ? ` in ${p.currentUnit}${p.currentLesson ? `, ${p.currentLesson}` : ''}` : '';
      lines.push(`- ${rollup.daysBehind > 0 ? `${rollup.daysBehind} day(s) behind pace` : 'On pace'}${where}.`);
    }
  }

  // Observation feedback.
  const feedback = [];
  if (obs.strengths) feedback.push(`Strengths: ${obs.strengths}`);
  if (obs.areasForGrowth) feedback.push(`Areas for growth: ${obs.areasForGrowth}`);
  if (obs.feedbackProvided) feedback.push(`Feedback: ${obs.feedbackProvided}`);
  if (feedback.length) {
    lines.push('', 'Observation feedback:');
    feedback.forEach((f) => lines.push(`- ${f}`));
  }

  // Action steps.
  const items = (obs.actionItems || []).filter((a) => a.description);
  if (items.length) {
    lines.push('', 'Action steps:');
    items.forEach((a) =>
      lines.push(`- ${a.description}${a.owner ? ` (owner: ${a.owner})` : ''}${a.dueDate ? ` by ${formatDate(a.dueDate)}` : ''}`)
    );
  }

  if (obs.followUpObservationDate) {
    lines.push('', `Next follow-up observation: ${formatDate(obs.followUpObservationDate)}.`);
  }

  lines.push('', 'Happy to talk through any of this. Reply here or stop by anytime.', '', 'Best,', coachName || 'Your Instructional Coach');
  return lines.join('\n');
}

// Observation records are assigned an id up front (rather than at save time)
// so newly attached files have a stable observationId to file under in blob
// storage before the record itself has ever been persisted.
function emptyForm() {
  return {
    id: crypto.randomUUID(),
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
    attachments: [],
  };
}

function newActionItem() {
  return { id: nid(), description: '', owner: '', dueDate: '', status: 'Open' };
}

export default function Observations() {
  const { observations, teachers, rollups, db, roleKey, user } = useApp();
  const writable = can(roleKey, 'write');

  const [teacherFilter, setTeacherFilter] = useState('all');
  const [engagementFilter, setEngagementFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [attachmentError, setAttachmentError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Blob keys uploaded during this form session that aren't attached to a
  // saved record yet. Cleaned up if the form is cancelled before saving.
  const [pendingKeys, setPendingKeys] = useState([]);
  // Blob keys for previously-saved attachments the user removed in this
  // session. Deletion is deferred until Save so a Cancel doesn't destroy a
  // blob that the persisted record still references.
  const [removedKeys, setRemovedKeys] = useState([]);

  const [viewId, setViewId] = useState(null);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_SORT_DIR[key] }));
  }

  // Email-a-teacher composer. Pre-filled from the observation and the teacher's
  // pacing rollup, then fully editable before it is handed to the mail client.
  const [emailObs, setEmailObs] = useState(null);
  const [emailDraft, setEmailDraft] = useState({ to: '', subject: '', body: '' });
  const [emailCopied, setEmailCopied] = useState(false);

  function openEmail(obs) {
    const teacher = teachers.find((t) => t.id === obs.teacherId);
    if (!teacher) return;
    const rollup = rollups.find((r) => r.teacher.id === obs.teacherId) || null;
    setEmailDraft({
      to: teacher.email || deriveTeacherEmail(teacher.name),
      subject: `Follow-up from your ${teacher.subject || 'class'} observation on ${formatDate(obs.date)}`,
      body: buildTeacherEmail(obs, rollup, teacher, user && user.name),
    });
    setEmailCopied(false);
    setEmailObs(obs);
  }

  function closeEmail() {
    setEmailObs(null);
    setEmailCopied(false);
  }

  function sendEmail() {
    const { to, subject, body } = emailDraft;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copyEmail() {
    const { to, subject, body } = emailDraft;
    try {
      await navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`);
      setEmailCopied(true);
    } catch {
      setEmailCopied(false);
    }
  }

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
    const dir = sort.dir === 'asc' ? 1 : -1;
    const compare = (a, b) => {
      if (sort.key === 'teacher') {
        const av = (teacherName[a.teacherId] || '').toLowerCase();
        const bv = (teacherName[b.teacherId] || '').toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      if (sort.key === 'engagement') {
        return ((ENGAGEMENT_RANK[a.engagementLevel] || 0) - (ENGAGEMENT_RANK[b.engagementLevel] || 0)) * dir;
      }
      // date-like columns: Date and Follow-up. Blank dates always sort last.
      const av = sort.key === 'followUp' ? a.followUpObservationDate : a.date;
      const bv = sort.key === 'followUp' ? b.followUpObservationDate : b.date;
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    };
    return observations
      .filter((o) => (teacherFilter === 'all' ? true : o.teacherId === teacherFilter))
      .filter((o) => (engagementFilter === 'all' ? true : o.engagementLevel === engagementFilter))
      .slice()
      .sort(compare);
  }, [observations, teacherFilter, engagementFilter, sort, teacherName]);

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

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (!form.teacherId) {
      setAttachmentError('Select a teacher before adding attachments.');
      return;
    }

    const accepted = [];
    const rejected = [];
    for (const file of files) {
      if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (unsupported type)`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${file.name} (too large)`);
        continue;
      }
      try {
        const uploaded = await uploadAttachment(file, form.teacherId, form.id);
        accepted.push({ id: nid(), ...uploaded });
        setPendingKeys((keys) => [...keys, uploaded.key]);
      } catch (err) {
        rejected.push(`${file.name} (${err.message})`);
      }
    }
    if (accepted.length) {
      setForm((f) => ({ ...f, attachments: [...(f.attachments || []), ...accepted] }));
    }
    setAttachmentError(rejected.length ? `Could not attach: ${rejected.join(', ')}` : null);
  }

  function removeAttachment(id) {
    const attachment = (form.attachments || []).find((a) => a.id === id);
    setForm((f) => ({ ...f, attachments: (f.attachments || []).filter((a) => a.id !== id) }));
    if (!attachment || !attachment.key) return;
    if (pendingKeys.includes(attachment.key)) {
      // Uploaded this session and never saved anywhere else — safe to delete now.
      deleteAttachment(attachment.key);
      setPendingKeys((keys) => keys.filter((k) => k !== attachment.key));
    } else {
      // Still referenced by the persisted record until Save confirms the removal.
      setRemovedKeys((keys) => [...keys, attachment.key]);
    }
  }

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setPendingKeys([]);
    setRemovedKeys([]);
    setAttachmentError(null);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(obs) {
    setEditingId(obs.id);
    setForm({
      id: obs.id,
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
      attachments: obs.attachments || [],
    });
    setPendingKeys([]);
    setRemovedKeys([]);
    setViewId(null);
    setAttachmentError(null);
    setSaveError(null);
    setFormOpen(true);
  }

  // Resets the form UI only. Used after a successful save, where any pending
  // attachment keys are now referenced by the saved record and must not be
  // deleted.
  function resetFormUI() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setPendingKeys([]);
    setRemovedKeys([]);
    setAttachmentError(null);
    setSaveError(null);
  }

  // Cancels the form: newly uploaded attachments that were never saved to a
  // record would otherwise sit orphaned in blob storage forever.
  function closeForm() {
    pendingKeys.forEach((key) => deleteAttachment(key));
    resetFormUI();
  }

  function canSave() {
    return !!form.teacherId && !!form.date;
  }

  // Awaited (unlike a fire-and-forget db call) so a failed write -- a bad
  // value Postgres rejects, a dropped connection -- surfaces as an error the
  // user can see and keeps the form open with their notes intact, instead of
  // the modal closing as if it saved while the record silently never landed.
  async function save() {
    if (!canSave() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await db.update('observations', editingId, { ...form }, 'updated observation');
      } else {
        await db.insert(
          'observations',
          { ...form, createdBy: 'coach', sharedWithTeacher: { whole: false, sections: [] } },
          'created observation'
        );
      }
      // Now that the record no longer references them, the removed blobs are safe to delete.
      removedKeys.forEach((key) => deleteAttachment(key));
      resetFormUI();
    } catch (err) {
      setSaveError(err.message || 'Failed to save this observation. Please try again.');
      setSaving(false);
    }
  }

  function toggleShareWhole(obs, checked) {
    const current = (obs.sharedWithTeacher && obs.sharedWithTeacher.sections) || [];
    db.update(
      'observations',
      obs.id,
      // Sharing the whole note supersedes section selections; unsharing it
      // preserves any per-section choices the coach had made.
      { sharedWithTeacher: { whole: checked, sections: current } },
      checked ? 'shared observation with teacher' : 'updated observation sharing'
    );
  }

  function toggleShareSection(obs, sectionKey, checked) {
    const shared = obs.sharedWithTeacher || { whole: false, sections: [] };
    const current = shared.sections || [];
    const sections = checked
      ? Array.from(new Set([...current, sectionKey]))
      : current.filter((k) => k !== sectionKey);
    db.update(
      'observations',
      obs.id,
      { sharedWithTeacher: { whole: !!shared.whole, sections } },
      'updated observation sharing'
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
                <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggleSort} />
                <SortHeader label="Teacher" sortKey="teacher" sort={sort} onSort={toggleSort} />
                <th>Lesson Observed</th>
                <th>Standard</th>
                <SortHeader label="Engagement" sortKey="engagement" sort={sort} onSort={toggleSort} />
                <SortHeader label="Follow-up" sortKey="followUp" sort={sort} onSort={toggleSort} />
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
                      {writable && (
                        <button className="btn btn--sm btn--ghost" onClick={() => openEmail(o)}>
                          Email
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
            onShareSection={(key, checked) => toggleShareSection(viewing, key, checked)}
          />
        </Modal>
      )}

      {/* ---- Email modal ---------------------------------------------------- */}
      {emailObs && (
        <Modal
          title={`Email ${teacherName[emailObs.teacherId] || 'teacher'}`}
          onClose={closeEmail}
          maxWidth={680}
          footer={
            <>
              <button className="btn btn--ghost" onClick={closeEmail}>
                Cancel
              </button>
              <button className="btn btn--ghost" onClick={copyEmail}>
                {emailCopied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn btn--primary" onClick={sendEmail} disabled={!emailDraft.to.trim()}>
                Open in email app
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>
              Drafted from this observation and the teacher's current pacing. Edit anything, then
              open it in your email app to review and send. Nothing is sent automatically.
            </p>
            <Field label="To">
              <input
                className="input"
                type="email"
                value={emailDraft.to}
                onChange={(e) => setEmailDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </Field>
            <Field label="Subject">
              <input
                className="input"
                type="text"
                value={emailDraft.subject}
                onChange={(e) => setEmailDraft((d) => ({ ...d, subject: e.target.value }))}
              />
            </Field>
            <Field label="Message">
              <textarea
                className="textarea"
                style={{ minHeight: 260 }}
                value={emailDraft.body}
                onChange={(e) => setEmailDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </Field>
          </div>
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
              {saveError && (
                <p className="small" style={{ color: 'var(--red-600)', margin: '0 auto 0 0' }}>
                  {saveError}
                </p>
              )}
              <button className="btn btn--ghost" onClick={closeForm}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={save} disabled={!canSave() || saving}>
                {saving ? 'Saving…' : 'Save'}
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

            <div className="section-title">Attachments</div>
            <Field label="Files" hint="PDF, JPG, PNG, or WEBP · max 10MB each">
              <input
                className="input"
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </Field>
            {attachmentError && (
              <p className="small" style={{ color: 'var(--red-600)', margin: 0 }}>
                {attachmentError}
              </p>
            )}
            {(form.attachments || []).length > 0 && (
              <ul className="checklist">
                {form.attachments.map((a) => (
                  <li key={a.id}>
                    <span className="check check--done">📎</span>
                    <span>
                      {a.name} <span className="muted small">· {a.sizeKB}KB</span>
                    </span>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => removeAttachment(a.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Read-only rendering of a full observation record, plus the leadership sharing
// control when the current role can write. Sections and feedback fields the
// teacher can see are flagged with a "Shared" pill.
function ViewBody({ obs, teacherName, writable, onShareWhole, onShareSection }) {
  const shared = obs.sharedWithTeacher || { whole: false, sections: [] };
  const isShared = (key) => !!shared.whole || (shared.sections || []).includes(key);

  return (
    <div className="stack">
      <SectionTitle shared={isShared('observation')}>Observation Information</SectionTitle>
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
      <ReadRow label="Strengths" value={obs.strengths} block shared={isShared('strengths')} />
      <ReadRow label="Areas for growth" value={obs.areasForGrowth} block shared={isShared('growth')} />
      <ReadRow label="Feedback provided" value={obs.feedbackProvided} block shared={isShared('feedback')} />

      <SectionTitle shared={isShared('followUp')}>Follow Up</SectionTitle>
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

      <SectionTitle shared={isShared('attachments')}>Attachments</SectionTitle>
      {(obs.attachments || []).length === 0 ? (
        <p className="muted small">No files attached.</p>
      ) : (
        <ul className="checklist">
          {obs.attachments.map((a) => (
            <li key={a.id}>
              <span className="check check--done">📎</span>
              <a href={attachmentUrl(a.key)} download={a.name} target="_blank" rel="noreferrer">
                {a.name}
              </a>
              <span className="muted small" style={{ marginLeft: 8 }}>
                {a.sizeKB}KB
              </span>
            </li>
          ))}
        </ul>
      )}

      {writable && (
        <>
          <div className="section-title">Share with teacher</div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={!!shared.whole}
              onChange={(e) => onShareWhole(e.target.checked)}
            />
            <span>Share entire note</span>
          </label>
          <div className="stack" style={{ gap: 6, marginTop: 8, paddingLeft: 24 }}>
            {SHAREABLE_SECTIONS.map((s) => (
              <label key={s.key} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={isShared(s.key)}
                  disabled={!!shared.whole}
                  onChange={(e) => onShareSection(s.key, e.target.checked)}
                />
                <span>
                  {s.group === 'feedback' ? 'Feedback' : 'Section'}: {s.label}
                </span>
              </label>
            ))}
          </div>
          <p className="muted small">
            Nothing is shared with the teacher automatically. Share the entire note, or choose
            individual sections and feedback to release.
          </p>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children, shared }) {
  return (
    <div className="section-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>{children}</span>
      {shared && <Badge tone="green">Shared</Badge>}
    </div>
  );
}

function ReadRow({ label, value, children, block, shared }) {
  const content = children != null ? children : value ? value : <span className="faint">—</span>;
  return (
    <div className="field">
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        {label}
        {shared && <Badge tone="green">Shared</Badge>}
      </label>
      {block ? <p className="small" style={{ margin: 0 }}>{content}</p> : <div>{content}</div>}
    </div>
  );
}
