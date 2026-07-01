// ---------------------------------------------------------------------------
// AI Pacing Calendar Reader modal.
//
// The manual-upload path for the Pacing Calendar Module: the coach pastes a
// scope-and-sequence / syllabus or uploads a PDF, Excel, or CSV file, and the
// assistant breaks it into a week-by-week
// list of units/lessons/standards/assessment dates (live via the Netlify
// Function, or a locally templated read when the function is offline). The
// result is an editable draft table; nothing is imported until the coach
// reviews every row and clicks Approve and Import.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Modal, Field } from './ui.jsx';
import { Icon } from './icons.jsx';
import { useApp } from '../state/AppContext.jsx';
import { analyzeCalendar, localCalendarAnalysis } from '../lib/calendarReader.js';
import { extractCalendarFile, CALENDAR_FILE_ACCEPT } from '../lib/fileExtract.js';

function rowId() {
  return 'row_' + Math.random().toString(36).slice(2, 9);
}

function emptyRow() {
  return { id: rowId(), weekOf: '', unit: '', lesson: '', standard: '', assessmentName: '', assessmentDate: '' };
}

export default function PacingCalendarReader({ onClose }) {
  const { rollups, pacingEntries, assessments, db } = useApp();

  const [teacherId, setTeacherId] = useState('');
  const [subject, setSubject] = useState('');
  const [calendarText, setCalendarText] = useState('');
  const [weeks, setWeeks] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [importedNote, setImportedNote] = useState(null);
  // PDF-upload path: { fileBase64, mediaType } handed to the model as a document
  // block. Text files (CSV/Excel/TXT) instead fill the textarea below.
  const [fileDoc, setFileDoc] = useState(null);
  const [fileName, setFileName] = useState('');
  const [extracting, setExtracting] = useState(false);

  const selectedTeacher = rollups.find((r) => r.teacher.id === teacherId)?.teacher;
  const subjectOptions = selectedTeacher?.subjects || [];

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setImportedNote(null);
    setExtracting(true);
    try {
      const out = await extractCalendarFile(file);
      if (out.kind === 'pdf') {
        setFileDoc({ fileBase64: out.fileBase64, mediaType: out.mediaType });
        setFileName(out.name);
        setCalendarText('');
      } else {
        // CSV / Excel / text extracted to plain text: fill the textarea so the
        // coach can review and edit it, and reuse the normal text pipeline.
        setFileDoc(null);
        setFileName(out.name);
        setCalendarText(out.text);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  function clearFile() {
    setFileDoc(null);
    setFileName('');
  }

  async function read() {
    const hasText = calendarText.trim();
    if (!hasText && !fileDoc) return;
    setLoading(true);
    setError(null);
    setImportedNote(null);
    const context = selectedTeacher
      ? `Teacher: ${selectedTeacher.name}. Subject: ${subject || selectedTeacher.subject || 'n/a'}. Grade: ${
          selectedTeacher.gradeLevel || 'n/a'
        }.`
      : '';
    try {
      const extracted = await analyzeCalendar(fileDoc ? '' : calendarText, context, fileDoc || undefined);
      setWeeks(extracted.map((w) => ({ id: rowId(), weekOf: '', unit: '', lesson: '', standard: '', assessmentName: '', assessmentDate: '', ...w })));
      setSource('ai');
    } catch (e) {
      if (e.reachable) {
        setError(
          `Live analysis failed: ${e.message} Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL in the Netlify site settings.`
        );
      } else if (fileDoc) {
        // A PDF has no offline path: reading the document needs the live model.
        setError(
          'Reading a PDF needs the live AI. Run on the deployed site, or paste the calendar text to use the offline demo read.'
        );
      } else {
        setWeeks(localCalendarAnalysis(calendarText).map((w) => ({ id: rowId(), ...w })));
        setSource('demo');
      }
    } finally {
      setLoading(false);
    }
  }

  function updateWeek(index, patch) {
    setWeeks((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addWeek() {
    setWeeks((rows) => [...rows, emptyRow()]);
  }

  function removeWeek(index) {
    setWeeks((rows) => rows.filter((_, i) => i !== index));
  }

  function approveAndImport() {
    if (!teacherId) return;
    if (subjectOptions.length > 0 && !subject) return;

    let pacingCount = 0;
    let assessmentCount = 0;

    weeks.forEach((w) => {
      if (w.weekOf && (w.unit || w.lesson || w.standard)) {
        const existing = pacingEntries.find(
          (p) => p.teacherId === teacherId && p.weekOf === w.weekOf && (p.subject || '') === (subject || '')
        );
        const patch = {
          teacherId,
          subject: subject || '',
          currentUnit: w.unit || '',
          currentLesson: w.lesson || '',
          currentStandard: w.standard || '',
        };
        if (existing) {
          db.update('pacingEntries', existing.id, patch, 'imported pacing calendar with AI');
        } else {
          db.insert(
            'pacingEntries',
            { ...patch, weekOf: w.weekOf, daysBehind: 0, exceptionReason: '', notes: 'Imported from pacing calendar.' },
            'imported pacing calendar with AI'
          );
        }
        pacingCount += 1;
      }

      if (w.assessmentName && w.assessmentDate) {
        const dup = assessments.some(
          (a) => a.teacherId === teacherId && a.name === w.assessmentName && a.date === w.assessmentDate
        );
        if (!dup) {
          db.insert(
            'assessments',
            { teacherId, name: w.assessmentName, date: w.assessmentDate, avgScore: null, proficiencyPct: null },
            'imported pacing calendar with AI'
          );
          assessmentCount += 1;
        }
      }
    });

    setImportedNote(
      `Imported ${pacingCount} pacing week(s) and ${assessmentCount} upcoming assessment(s) for ${
        selectedTeacher?.name || 'this teacher'
      }.`
    );
  }

  return (
    <Modal
      title="AI Pacing Calendar Reader"
      onClose={onClose}
      maxWidth={880}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Paste a scope-and-sequence, syllabus, or unit plan, or upload a PDF, Excel, or CSV file.
          The assistant breaks it into a week-by-week list of units, lessons, standards, and
          assessment dates. Review and edit every row before anything is imported into pacing or
          assessments.
        </p>

        <div className="form-row">
          <Field label="Teacher">
            <select
              className="select"
              value={teacherId}
              onChange={(e) => {
                setTeacherId(e.target.value);
                setSubject('');
              }}
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
        </div>

        <Field label="Upload a file" hint="PDF, Excel (.xlsx/.xls), CSV, or text · max 4MB">
          <input
            className="input"
            type="file"
            accept={CALENDAR_FILE_ACCEPT}
            onChange={handleFile}
            disabled={extracting}
          />
        </Field>
        {extracting && <p className="small muted" style={{ margin: 0 }}>Reading file...</p>}
        {fileName && (
          <div className="row row--between" style={{ gap: 8 }}>
            <span className="pill pill--amber">
              <span className="dot" />
              {fileDoc ? `PDF ready: ${fileName}` : `Loaded ${fileName} into the text below`}
            </span>
            <button className="btn btn--ghost btn--sm" onClick={clearFile}>
              Remove file
            </button>
          </div>
        )}

        <Field label="Pacing calendar text" hint={fileDoc ? 'A PDF is loaded; typing here switches to text instead.' : undefined}>
          <textarea
            className="textarea"
            style={{ minHeight: 140 }}
            value={calendarText}
            onChange={(e) => {
              setCalendarText(e.target.value);
              if (fileDoc) clearFile(); // typing supersedes a loaded PDF
            }}
            placeholder={fileDoc ? 'PDF loaded above. Type here to read text instead.' : 'Paste the scope-and-sequence or syllabus here...'}
          />
        </Field>

        <div className="row" style={{ gap: 10 }}>
          <button
            className="btn btn--primary"
            onClick={read}
            disabled={loading || extracting || (!calendarText.trim() && !fileDoc)}
          >
            <Icon name="sparkle" /> {loading ? 'Reading...' : weeks.length ? 'Re-read Calendar with AI' : 'Read Calendar with AI'}
          </button>
        </div>

        {error && <div className="banner banner--danger">{error}</div>}

        {weeks.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row row--between row--wrap" style={{ gap: 8 }}>
              <span className="pill pill--amber">
                <span className="dot" /> Draft, pending review
              </span>
              <span className="small muted">
                {source === 'ai' ? 'Generated live by Claude' : 'Demo read (offline). Live AI runs on the deployed site.'}
              </span>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Unit</th>
                  <th>Lesson</th>
                  <th>Standard</th>
                  <th>Assessment</th>
                  <th>Assessment date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={w.id}>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={w.weekOf || ''}
                        onChange={(e) => updateWeek(i, { weekOf: e.target.value })}
                      />
                    </td>
                    <td>
                      <input className="input" value={w.unit || ''} onChange={(e) => updateWeek(i, { unit: e.target.value })} />
                    </td>
                    <td>
                      <input className="input" value={w.lesson || ''} onChange={(e) => updateWeek(i, { lesson: e.target.value })} />
                    </td>
                    <td>
                      <input className="input" value={w.standard || ''} onChange={(e) => updateWeek(i, { standard: e.target.value })} />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={w.assessmentName || ''}
                        onChange={(e) => updateWeek(i, { assessmentName: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={w.assessmentDate || ''}
                        onChange={(e) => updateWeek(i, { assessmentDate: e.target.value })}
                      />
                    </td>
                    <td>
                      <button className="btn btn--ghost btn--sm" onClick={() => removeWeek(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn--ghost btn--sm" onClick={addWeek}>
              + Add week
            </button>

            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={approveAndImport}
                disabled={!teacherId || (subjectOptions.length > 0 && !subject)}
              >
                <Icon name="interventions" /> Approve and Import
              </button>
            </div>
          </div>
        )}

        {importedNote && <div className="banner banner--info">{importedNote}</div>}
      </div>
    </Modal>
  );
}
