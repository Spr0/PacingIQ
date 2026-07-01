// ---------------------------------------------------------------------------
// Editable action plans, in two tiers:
//   - Common/broad templates: pre-built, reusable across every teacher.
//   - Teacher-specific plans: created from scratch or from a template, then
//     customized (steps, owners, due dates, status) for this teacher.
// Both tiers are created, edited, and saved from this tab. Read-only for
// roles without write access, matching the rest of the app.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { formatDate, isoDate } from '../lib/dates.js';
import { Card, Badge, Empty, Field, Modal } from './ui.jsx';

const STEP_STATUSES = ['Open', 'In Progress', 'Complete'];
const STATUS_TONE = { Open: 'neutral', 'In Progress': 'yellow', Complete: 'green' };

function genId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyStep() {
  return { id: genId('step'), description: '', owner: '', dueDate: '', status: 'Open' };
}

function emptyTemplateStep() {
  return { id: genId('tstep'), description: '', defaultOwner: '' };
}

const EMPTY_PLAN_FORM = { id: null, title: '', templateId: '', source: 'custom', steps: [emptyStep()] };
const EMPTY_TEMPLATE_FORM = { id: null, title: '', category: '', description: '', steps: [emptyTemplateStep()] };

export default function ActionPlans({ teacherId, plans, templates, db, writable }) {
  const [planModal, setPlanModal] = useState(false);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN_FORM);

  const [templateModal, setTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);

  const sortedPlans = [...plans].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  // --- Teacher-specific plans -----------------------------------------------

  function openNewPlan(templateId = '') {
    const tpl = templates.find((t) => t.id === templateId);
    setPlanForm({
      id: null,
      title: tpl ? tpl.title : '',
      templateId: tpl ? tpl.id : '',
      source: tpl ? 'template' : 'custom',
      steps: tpl
        ? tpl.steps.map((s) => ({ id: genId('step'), description: s.description, owner: s.defaultOwner || '', dueDate: '', status: 'Open' }))
        : [emptyStep()],
    });
    setPlanModal(true);
  }

  function openEditPlan(plan) {
    setPlanForm({
      id: plan.id,
      title: plan.title,
      templateId: plan.templateId || '',
      source: plan.source || 'custom',
      steps: plan.steps.length ? plan.steps.map((s) => ({ ...s })) : [emptyStep()],
    });
    setPlanModal(true);
  }

  function updatePlanStep(index, patch) {
    setPlanForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function addPlanStep() {
    setPlanForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }));
  }

  function removePlanStep(index) {
    setPlanForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }));
  }

  function savePlan() {
    const title = planForm.title.trim();
    if (!title) return;
    const steps = planForm.steps
      .map((s) => ({ ...s, description: s.description.trim(), owner: s.owner.trim() }))
      .filter((s) => s.description);

    const patch = {
      teacherId,
      title,
      templateId: planForm.templateId || '',
      source: planForm.source,
      steps,
      updatedAt: isoDate(),
    };

    if (planForm.id) {
      db.update('actionPlans', planForm.id, patch, 'updated action plan');
    } else {
      db.insert('actionPlans', { ...patch, createdAt: isoDate() }, 'created action plan');
    }
    setPlanModal(false);
    setPlanForm(EMPTY_PLAN_FORM);
  }

  function deletePlan(plan) {
    db.remove('actionPlans', plan.id, 'deleted action plan');
  }

  function changeStepStatus(plan, stepId, status) {
    const steps = plan.steps.map((s) => (s.id === stepId ? { ...s, status } : s));
    db.update('actionPlans', plan.id, { steps, updatedAt: isoDate() }, 'updated action plan');
  }

  // --- Common templates ------------------------------------------------------

  function openNewTemplate() {
    setTemplateForm(EMPTY_TEMPLATE_FORM);
    setTemplateModal(true);
  }

  function openEditTemplate(tpl) {
    setTemplateForm({
      id: tpl.id,
      title: tpl.title,
      category: tpl.category || '',
      description: tpl.description || '',
      steps: tpl.steps.length ? tpl.steps.map((s) => ({ ...s })) : [emptyTemplateStep()],
    });
    setTemplateModal(true);
  }

  function updateTemplateStep(index, patch) {
    setTemplateForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function addTemplateStep() {
    setTemplateForm((f) => ({ ...f, steps: [...f.steps, emptyTemplateStep()] }));
  }

  function removeTemplateStep(index) {
    setTemplateForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }));
  }

  function saveTemplate() {
    const title = templateForm.title.trim();
    if (!title) return;
    const steps = templateForm.steps
      .map((s) => ({ ...s, description: s.description.trim(), defaultOwner: s.defaultOwner.trim() }))
      .filter((s) => s.description);

    const patch = {
      title,
      category: templateForm.category.trim(),
      description: templateForm.description.trim(),
      steps,
    };

    if (templateForm.id) {
      db.update('actionPlanTemplates', templateForm.id, patch, 'updated action plan template');
    } else {
      db.insert('actionPlanTemplates', patch, 'created action plan template');
    }
    setTemplateModal(false);
    setTemplateForm(EMPTY_TEMPLATE_FORM);
  }

  function deleteTemplate(tpl) {
    db.remove('actionPlanTemplates', tpl.id, 'deleted action plan template');
  }

  return (
    <div className="grid grid--2">
      {/* Tier 1: common, reusable templates */}
      <Card
        title="Common Action Plan Templates"
        count={templates.length}
        action={
          writable && (
            <button className="btn btn--ghost btn--sm" onClick={openNewTemplate}>
              New template
            </button>
          )
        }
      >
        <p className="muted small mb-2">
          Pre-built plans reusable across any teacher. Start a teacher's plan from one of these, or edit
          them here to keep the library current.
        </p>
        {templates.length === 0 ? (
          <Empty icon="🗂">No templates yet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {templates.map((tpl) => (
              <div key={tpl.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card__body">
                  <div className="row row--between" style={{ gap: 8 }}>
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{tpl.title}</strong>
                        {tpl.category && <Badge tone="brand">{tpl.category}</Badge>}
                      </div>
                      {tpl.description && <p className="muted small mt-0 mb-0">{tpl.description}</p>}
                    </div>
                  </div>
                  <ul className="checklist mt-1">
                    {tpl.steps.map((s) => (
                      <li key={s.id}>
                        <span className="check check--todo">✓</span>
                        <span>
                          {s.description}
                          {s.defaultOwner && <span className="muted small"> · {s.defaultOwner}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {writable && (
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => openNewPlan(tpl.id)}>
                        Use for this teacher
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => openEditTemplate(tpl)}>
                        Edit
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => deleteTemplate(tpl)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Tier 2: this teacher's plans */}
      <Card
        title="This Teacher's Action Plans"
        count={sortedPlans.length}
        action={
          writable && (
            <button className="btn btn--primary btn--sm" onClick={() => openNewPlan()}>
              New action plan
            </button>
          )
        }
      >
        {sortedPlans.length === 0 ? (
          <Empty icon="📝">No action plans for this teacher yet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {sortedPlans.map((plan) => (
              <div key={plan.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card__body">
                  <div className="row row--between" style={{ gap: 8 }}>
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{plan.title}</strong>
                        <Badge tone={plan.source === 'template' ? 'brand' : 'neutral'}>
                          {plan.source === 'template' ? 'From template' : 'Custom'}
                        </Badge>
                      </div>
                      <p className="muted small mt-0 mb-0">Updated {formatDate(plan.updatedAt)}</p>
                    </div>
                    {writable && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => openEditPlan(plan)}>
                          Edit
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => deletePlan(plan)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {plan.steps.length === 0 ? (
                    <p className="muted small mt-1">No steps recorded.</p>
                  ) : (
                    <table className="table mt-1">
                      <thead>
                        <tr>
                          <th>Step</th>
                          <th>Owner</th>
                          <th>Due</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.steps.map((s) => (
                          <tr key={s.id}>
                            <td>{s.description}</td>
                            <td>{s.owner || '—'}</td>
                            <td>{s.dueDate ? formatDate(s.dueDate) : '—'}</td>
                            <td>
                              {writable ? (
                                <select
                                  className="select"
                                  value={s.status}
                                  onChange={(e) => changeStepStatus(plan, s.id, e.target.value)}
                                >
                                  {STEP_STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                      {st}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Badge tone={STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* New / edit teacher-specific plan */}
      {planModal && (
        <Modal
          title={planForm.id ? 'Edit Action Plan' : 'New Action Plan'}
          onClose={() => setPlanModal(false)}
          maxWidth={620}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPlanModal(false)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={savePlan} disabled={!planForm.title.trim()}>
                Save plan
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Title">
              <input
                className="input"
                value={planForm.title}
                onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                placeholder="e.g. Pacing Recovery Plan"
                autoFocus
              />
            </Field>

            {templates.length > 0 && !planForm.id && (
              <Field label="Start from a template" hint="optional">
                <select
                  className="select"
                  value={planForm.templateId}
                  onChange={(e) => openNewPlan(e.target.value)}
                >
                  <option value="">Blank plan</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="section-title">Steps</div>
            <div className="stack" style={{ gap: 10 }}>
              {planForm.steps.map((s, i) => (
                <div key={s.id} className="stack" style={{ gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--slate-100)' }}>
                  <Field label={`Step ${i + 1}`}>
                    <input
                      className="input"
                      value={s.description}
                      onChange={(e) => updatePlanStep(i, { description: e.target.value })}
                      placeholder="Describe the agreed action"
                    />
                  </Field>
                  <div className="form-row--3" style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr 1fr auto' }}>
                    <input
                      className="input"
                      value={s.owner}
                      onChange={(e) => updatePlanStep(i, { owner: e.target.value })}
                      placeholder="Owner"
                    />
                    <input
                      className="input"
                      type="date"
                      value={s.dueDate}
                      onChange={(e) => updatePlanStep(i, { dueDate: e.target.value })}
                    />
                    <select
                      className="select"
                      value={s.status}
                      onChange={(e) => updatePlanStep(i, { status: e.target.value })}
                    >
                      {STEP_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn--ghost btn--sm" onClick={() => removePlanStep(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn--ghost btn--sm" onClick={addPlanStep}>
              + Add step
            </button>
          </div>
        </Modal>
      )}

      {/* New / edit common template */}
      {templateModal && (
        <Modal
          title={templateForm.id ? 'Edit Template' : 'New Template'}
          onClose={() => setTemplateModal(false)}
          maxWidth={620}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setTemplateModal(false)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={saveTemplate} disabled={!templateForm.title.trim()}>
                Save template
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Title">
              <input
                className="input"
                value={templateForm.title}
                onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })}
                placeholder="e.g. Pacing Recovery Plan"
                autoFocus
              />
            </Field>
            <div className="form-row">
              <Field label="Category" hint="optional">
                <input
                  className="input"
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })}
                  placeholder="e.g. Pacing"
                />
              </Field>
              <Field label="Description" hint="optional">
                <input
                  className="input"
                  value={templateForm.description}
                  onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                  placeholder="When should coaches use this?"
                />
              </Field>
            </div>

            <div className="section-title">Steps</div>
            <div className="stack" style={{ gap: 8 }}>
              {templateForm.steps.map((s, i) => (
                <div key={s.id} className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 2 }}
                    value={s.description}
                    onChange={(e) => updateTemplateStep(i, { description: e.target.value })}
                    placeholder="Step description"
                  />
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={s.defaultOwner}
                    onChange={(e) => updateTemplateStep(i, { defaultOwner: e.target.value })}
                    placeholder="Default owner"
                  />
                  <button className="btn btn--ghost btn--sm" onClick={() => removeTemplateStep(i)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn--ghost btn--sm" onClick={addTemplateStep}>
              + Add step
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
