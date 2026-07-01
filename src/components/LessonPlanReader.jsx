// ---------------------------------------------------------------------------
// AI Lesson Plan Reader modal.
//
// The coach pastes a lesson plan, the assistant extracts unit/lesson/
// standard/objective/assessment references/pacing concerns (live via the
// Netlify Function, or a locally templated read when the function is
// offline). The result is a draft: nothing is applied to the teacher's
// pacing record until the coach reviews the fields and clicks Apply.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Modal, Field } from './ui.jsx';
import { Icon } from './icons.jsx';
import { useApp } from '../state/AppContext.jsx';
import { isoDate } from '../lib/dates.js';
import { analyzeLessonPlan, localLessonAnalysis } from '../lib/lessonReader.js';

export default function LessonPlanReader({ teacher, onClose }) {
  const { db, pacingEntries } = useApp();
  const subjectOptions = teacher.subjects || [];

  const [lessonText, setLessonText] = useState('');
  const [subject, setSubject] = useState(subjectOptions[0] || '');
  const [result, setResult] = useState(null);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [appliedNote, setAppliedNote] = useState(null);

  async function read() {
    if (!lessonText.trim()) return;
    setLoading(true);
    setError(null);
    setAppliedNote(null);
    const context = `Teacher: ${teacher.name}. Subject: ${
      subject || teacher.subject || 'n/a'
    }. Grade: ${teacher.gradeLevel || 'n/a'}.`;
    try {
      const data = await analyzeLessonPlan(lessonText, context);
      setResult(data);
      setSource('ai');
    } catch (e) {
      if (e.reachable) {
        setError(
          `Live analysis failed: ${e.message} Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL in the Netlify site settings.`
        );
      } else {
        setResult(localLessonAnalysis(lessonText));
        setSource('demo');
      }
    } finally {
      setLoading(false);
    }
  }

  function updateField(key, value) {
    setResult((r) => ({ ...r, [key]: value }));
  }

  function applyToPacing() {
    if (!result) return;
    if (subjectOptions.length > 0 && !subject) return;

    const weeks = pacingEntries.map((p) => p.weekOf).filter(Boolean).sort();
    const currentWeek = weeks.length ? weeks[weeks.length - 1] : isoDate();
    const existing = pacingEntries.find(
      (p) =>
        p.teacherId === teacher.id &&
        p.weekOf === currentWeek &&
        (p.subject || '') === (subject || '')
    );

    const patch = {
      teacherId: teacher.id,
      subject: subject || '',
      currentUnit: result.unit || (existing && existing.currentUnit) || '',
      currentLesson: result.lesson || (existing && existing.currentLesson) || '',
      currentStandard: result.standard || (existing && existing.currentStandard) || '',
    };

    if (existing) {
      db.update('pacingEntries', existing.id, patch, 'applied AI lesson read to pacing');
    } else {
      db.insert(
        'pacingEntries',
        { ...patch, weekOf: currentWeek, daysBehind: 0, exceptionReason: '', notes: '' },
        'applied AI lesson read to pacing'
      );
    }
    setAppliedNote(`Applied to ${teacher.name}'s current-week pacing.`);
  }

  function discard() {
    setResult(null);
    setSource(null);
    setError(null);
    setAppliedNote(null);
  }

  return (
    <Modal
      title={`AI Lesson Plan Reader · ${teacher.name}`}
      onClose={onClose}
      maxWidth={720}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Paste a lesson plan. The assistant identifies the unit, lesson, standard, objective,
          assessment references, and any pacing concerns. Review and edit before applying anything
          to this teacher's pacing record.
        </p>

        <Field label="Lesson plan text">
          <textarea
            className="textarea"
            style={{ minHeight: 140 }}
            value={lessonText}
            onChange={(e) => setLessonText(e.target.value)}
            placeholder="Paste the lesson plan here..."
          />
        </Field>

        {subjectOptions.length > 0 && (
          <Field label="Subject" hint="this teacher covers multiple subjects">
            <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Select a subject</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--primary" onClick={read} disabled={loading || !lessonText.trim()}>
            <Icon name="sparkle" /> {loading ? 'Reading...' : result ? 'Re-read Lesson Plan with AI' : 'Read Lesson Plan with AI'}
          </button>
        </div>

        {error && <div className="banner banner--danger">{error}</div>}

        {result && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row row--between row--wrap" style={{ gap: 8 }}>
              <span className="pill pill--amber">
                <span className="dot" /> Draft, pending review
              </span>
              <span className="small muted">
                {source === 'ai' ? 'Generated live by Claude' : 'Demo read (offline). Live AI runs on the deployed site.'}
              </span>
            </div>

            <div className="form-row">
              <Field label="Unit">
                <input
                  className="input"
                  value={result.unit || ''}
                  onChange={(e) => updateField('unit', e.target.value)}
                />
              </Field>
              <Field label="Lesson">
                <input
                  className="input"
                  value={result.lesson || ''}
                  onChange={(e) => updateField('lesson', e.target.value)}
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Standard">
                <input
                  className="input"
                  value={result.standard || ''}
                  onChange={(e) => updateField('standard', e.target.value)}
                />
              </Field>
              <Field label="Objective">
                <input
                  className="input"
                  value={result.objective || ''}
                  onChange={(e) => updateField('objective', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Assessment references">
              <input
                className="input"
                value={(result.assessmentReferences || []).join(', ')}
                onChange={(e) =>
                  updateField(
                    'assessmentReferences',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
              />
            </Field>
            <Field label="Pacing concerns">
              <textarea
                className="textarea"
                value={result.pacingConcerns || ''}
                onChange={(e) => updateField('pacingConcerns', e.target.value)}
              />
            </Field>

            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={applyToPacing}
                disabled={subjectOptions.length > 0 && !subject}
              >
                <Icon name="pacing" /> Apply to this week's pacing
              </button>
              <button className="btn btn--ghost" onClick={discard}>
                Discard
              </button>
            </div>
          </div>
        )}

        {appliedNote && <div className="banner banner--info">{appliedNote}</div>}
      </div>
    </Modal>
  );
}
