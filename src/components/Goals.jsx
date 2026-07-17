// ---------------------------------------------------------------------------
// Teacher goals: a single target (not a multi-step plan) with an owner, an
// optional target date, and a status. Goals with a target date can be pushed
// to Google Calendar or Outlook (real web links, no OAuth needed) or
// downloaded as .ics. They also feed the shared "outstanding action items"
// rollup (src/lib/intelligence.js) alongside observation and intervention
// action items, so a goal shows up on the dashboard and teacher overview
// exactly like any other open action item until it's marked Complete.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { formatDate, isoDate } from '../lib/dates.js';
import { isOverdue } from '../lib/intelligence.js';
import { googleCalendarUrl, outlookCalendarUrl, downloadGoalIcs } from '../lib/calendarExport.js';
import { Card, Badge, Empty, Field, Modal } from './ui.jsx';

const GOAL_STATUSES = ['Open', 'In Progress', 'Complete'];
const STATUS_TONE = { Open: 'neutral', 'In Progress': 'yellow', Complete: 'green' };

function emptyGoal(teacherName) {
  return { id: null, title: '', notes: '', category: '', owner: teacherName || '', targetDate: '', status: 'Open' };
}

export default function Goals({ teacherId, teacherName, goals, db, writable }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(() => emptyGoal(teacherName));

  const sorted = [...goals].sort((a, b) => (a.targetDate || '9999') < (b.targetDate || '9999') ? -1 : 1);

  function openNew() {
    setForm(emptyGoal(teacherName));
    setModal(true);
  }

  function openEdit(goal) {
    setForm({
      id: goal.id,
      title: goal.title,
      notes: goal.notes || '',
      category: goal.category || '',
      owner: goal.owner || '',
      targetDate: goal.targetDate || '',
      status: goal.status || 'Open',
    });
    setModal(true);
  }

  function save() {
    const title = form.title.trim();
    if (!title) return;
    const patch = {
      teacherId,
      title,
      notes: form.notes.trim(),
      category: form.category.trim(),
      owner: form.owner.trim(),
      targetDate: form.targetDate,
      status: form.status,
      updatedAt: isoDate(),
    };
    if (form.id) {
      db.update('goals', form.id, patch, 'updated goal');
    } else {
      db.insert('goals', { ...patch, createdAt: isoDate() }, 'created goal');
    }
    setModal(false);
  }

  function deleteGoal(goal) {
    db.remove('goals', goal.id, 'deleted goal');
  }

  function changeStatus(goal, status) {
    db.update('goals', goal.id, { status, updatedAt: isoDate() }, 'updated goal');
  }

  return (
    <Card
      title="Goals"
      count={sorted.length}
      action={
        writable && (
          <button className="btn btn--primary btn--sm" onClick={openNew}>
            New goal
          </button>
        )
      }
    >
      {sorted.length === 0 ? (
        <Empty icon="🎯">No goals set for this teacher yet.</Empty>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Target date</th>
                <th>Status</th>
                <th>Calendar</th>
                {writable && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => {
                const overdue = isOverdue({ dueDate: g.targetDate, status: g.status });
                const gcal = googleCalendarUrl(g);
                const outlook = outlookCalendarUrl(g);
                return (
                  <tr key={g.id}>
                    <td>
                      <div>{g.title}</div>
                      {g.notes && <div className="muted small">{g.notes}</div>}
                    </td>
                    <td>{g.category ? <Badge tone="brand">{g.category}</Badge> : '—'}</td>
                    <td>{g.owner || '—'}</td>
                    <td style={overdue ? { color: 'var(--red-600)' } : undefined}>
                      {g.targetDate ? formatDate(g.targetDate) : '—'}
                      {overdue ? ' (overdue)' : ''}
                    </td>
                    <td>
                      {writable ? (
                        <select
                          className="select"
                          value={g.status}
                          onChange={(e) => changeStatus(g, e.target.value)}
                        >
                          {GOAL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={STATUS_TONE[g.status] || 'neutral'}>{g.status}</Badge>
                      )}
                    </td>
                    <td>
                      {gcal ? (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <a className="btn btn--ghost btn--sm" href={gcal} target="_blank" rel="noreferrer">
                            Google
                          </a>
                          <a className="btn btn--ghost btn--sm" href={outlook} target="_blank" rel="noreferrer">
                            Outlook
                          </a>
                          <button className="btn btn--ghost btn--sm" onClick={() => downloadGoalIcs(g)}>
                            .ics
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">Set a target date to sync</span>
                      )}
                    </td>
                    {writable && (
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn--ghost btn--sm" onClick={() => openEdit(g)}>
                            Edit
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={() => deleteGoal(g)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small mt-2">
            Google and Outlook open a pre-filled event on the coach's own calendar; .ics works with Apple
            Calendar or any other app. Automatic two-way sync (goal changes updating an existing Google
            Classroom or Outlook event) needs OAuth credentials this environment doesn't have — see the
            README fast-follow note.
          </p>
        </>
      )}

      {modal && (
        <Modal
          title={form.id ? 'Edit Goal' : 'New Goal'}
          onClose={() => setModal(false)}
          maxWidth={560}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setModal(false)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={save} disabled={!form.title.trim()}>
                Save goal
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Goal">
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Raise exit-ticket mastery on linear functions to 80%"
                autoFocus
              />
            </Field>
            <Field label="Notes" hint="optional">
              <textarea
                className="textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Context, rationale, or how progress will be measured"
              />
            </Field>
            <div className="form-row">
              <Field label="Category" hint="optional">
                <input
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Instruction"
                />
              </Field>
              <Field label="Owner">
                <input
                  className="input"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Target date" hint="optional, needed to sync to a calendar">
                <input
                  className="input"
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                />
              </Field>
              <Field label="Status">
                <select
                  className="select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {GOAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
