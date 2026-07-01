// ---------------------------------------------------------------------------
// AI Coaching Assistant modal.
//
// The coach picks a content type and generates a draft (live via the Netlify
// Function, or a locally templated draft when the function is offline). Per the
// spec, ALL AI content requires human approval before it is saved: the draft is
// editable and nothing is persisted until the coach clicks Approve and save.
// Approved drafts are appended to the teacher record (teacher.aiDrafts) and an
// audit entry is logged. Nothing is ever sent automatically.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Modal } from './ui.jsx';
import { Icon } from './icons.jsx';
import { useApp } from '../state/AppContext.jsx';
import {
  CONTENT_TYPES,
  labelFor,
  buildContext,
  generateDraft,
  localDraft,
} from '../lib/coachAssist.js';

function genId() {
  return 'ai_' + Math.random().toString(36).slice(2, 9);
}

// One-line explanation of what each generator does, shown before the coach
// clicks Generate so the trigger and its effect are never a surprise.
const EXPLANATIONS = {
  summary:
    'Drafts a two-paragraph private coaching summary from this teacher’s current pacing, most recent observation, and assessment signal.',
  principal_report:
    'Drafts a brief, objective status report for the principal: current status, key concern, support provided, and recommended next step.',
  follow_up_email:
    'Drafts a follow-up email from you to the teacher: one strength, one growth focus, and one concrete next step.',
  meeting_agenda:
    'Drafts a focused coaching meeting agenda from this teacher’s current pacing, assessment signal, and open action items.',
  action_plan:
    'Drafts a short action plan: the concern, the likely root cause, three agreed actions with owners, and a follow-up checkpoint.',
};

export default function CoachAssistant({ rollup, observations, assessments, initialKind, onClose }) {
  const { user, db, teachers } = useApp();
  const teacher = teachers.find((t) => t.id === rollup.teacher.id) || rollup.teacher;
  const saved = teacher.aiDrafts || [];

  const [kind, setKind] = useState(initialKind || 'summary');
  const [language, setLanguage] = useState('en'); // 'en' | 'es'
  const [draft, setDraft] = useState('');
  const [draftLanguage, setDraftLanguage] = useState('en');
  const [source, setSource] = useState(null); // 'ai' | 'demo'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedNote, setSavedNote] = useState(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setSavedNote(null);
    const context = buildContext(rollup, observations, assessments, user.name);
    try {
      const text = await generateDraft(kind, context, language);
      setDraft(text);
      setSource('ai');
      setDraftLanguage(language);
    } catch (e) {
      if (e.reachable) {
        // The function ran but failed. Surface the config error loudly rather
        // than masking it with a demo draft.
        setError(
          `Live generation failed: ${e.message} Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL in the Netlify site settings.`
        );
      } else {
        // Function not deployed here (for example the vite preview). Fall back.
        // The demo template is English-only, so the badge reflects that regardless
        // of the language toggle.
        setDraft(localDraft(kind, rollup, observations, assessments, user.name));
        setSource('demo');
        setDraftLanguage('en');
      }
    } finally {
      setLoading(false);
    }
  }

  function approveAndSave() {
    const entry = {
      id: genId(),
      kind,
      label: labelFor(kind),
      text: draft,
      source,
      language: draftLanguage,
      approvedBy: user.name,
      approvedAt: new Date().toISOString(),
    };
    db.update(
      'teachers',
      teacher.id,
      { aiDrafts: [...saved, entry] },
      `approved AI ${labelFor(kind).toLowerCase()}`
    );
    setSavedNote(`${labelFor(kind)} approved and saved to ${teacher.name}'s record.`);
    setDraft('');
    setSource(null);
  }

  function discard() {
    setDraft('');
    setSource(null);
    setError(null);
  }

  return (
    <Modal
      title={`AI Coaching Assistant · ${teacher.name}`}
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
          Generate a draft, review and edit it, then approve to save. All AI content requires your
          approval before it is saved. Nothing is sent to anyone automatically.
        </p>

        {/* Content type selector */}
        <div className="pill-tabs" style={{ marginBottom: 0 }}>
          {CONTENT_TYPES.map((c) => (
            <button
              key={c.key}
              className={kind === c.key ? 'active' : undefined}
              onClick={() => {
                setKind(c.key);
                setDraft('');
                setSource(null);
                setSavedNote(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Language selector */}
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="small muted">Language</span>
          <div className="pill-tabs" style={{ marginBottom: 0 }}>
            <button
              className={language === 'en' ? 'active' : undefined}
              onClick={() => {
                setLanguage('en');
                setDraft('');
                setSource(null);
                setSavedNote(null);
              }}
            >
              English
            </button>
            <button
              className={language === 'es' ? 'active' : undefined}
              onClick={() => {
                setLanguage('es');
                setDraft('');
                setSource(null);
                setSavedNote(null);
              }}
            >
              Español
            </button>
          </div>
        </div>

        {EXPLANATIONS[kind] && (
          <p className="muted small" style={{ margin: 0 }}>
            {EXPLANATIONS[kind]}
          </p>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn--primary" onClick={generate} disabled={loading}>
            <Icon name="sparkle" />{' '}
            {loading
              ? 'Generating...'
              : draft
              ? `Regenerate ${labelFor(kind)} with AI`
              : `Generate ${labelFor(kind)} with AI`}
          </button>
          {draft && (
            <button className="btn" onClick={() => navigator.clipboard?.writeText(draft)}>
              Copy
            </button>
          )}
        </div>

        {error && <div className="banner banner--danger">{error}</div>}

        {draft && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row row--between row--wrap" style={{ gap: 8 }}>
              <div className="row row--wrap" style={{ gap: 8 }}>
                <span className="pill pill--amber">
                  <span className="dot" /> Draft, pending approval
                </span>
                <span className="pill pill--neutral">
                  {draftLanguage === 'es' ? '🇪🇸 Español' : '🇺🇸 English'}
                </span>
              </div>
              <span className="small muted">
                {source === 'ai' ? 'Generated live by Claude' : 'Demo draft (offline). Live AI runs on the deployed site.'}
              </span>
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 220, fontFamily: 'var(--font-sans)' }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn--primary" onClick={approveAndSave} disabled={!draft.trim()}>
                <Icon name="interventions" /> Approve and save
              </button>
              <button className="btn btn--ghost" onClick={discard}>
                Discard
              </button>
            </div>
          </div>
        )}

        {savedNote && <div className="banner banner--info">{savedNote}</div>}

        {/* Approved drafts on record */}
        {saved.length > 0 && (
          <div>
            <div className="section-title">Approved drafts on record ({saved.length})</div>
            <ul className="timeline">
              {[...saved].reverse().map((d) => (
                <li key={d.id} className="timeline__item">
                  <div className="timeline__time">
                    {new Date(d.approvedAt).toLocaleString()} · approved by {d.approvedBy}
                    {d.source === 'demo' ? ' · demo' : ''}
                  </div>
                  <div className="row row--wrap" style={{ gap: 8, marginBottom: 4 }}>
                    <span className="badge badge--brand">{d.label}</span>
                    {d.language === 'es' && <span className="pill pill--neutral">🇪🇸 Español</span>}
                  </div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {d.text.length > 240 ? `${d.text.slice(0, 240)}...` : d.text}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
