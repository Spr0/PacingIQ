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
import { extractUploadedFile, sheetLooksLikePacing, UPLOAD_FILE_ACCEPT } from '../lib/fileExtract.js';

// Mirrors MAX_CHARS_PER_CALL in lib/calendarReader.js, only to show the coach
// roughly how many model calls a selection will cost before she commits to it.
const CHARS_PER_CALL = 1200;

function estimateCalls(chars) {
  return Math.max(1, Math.ceil(chars / CHARS_PER_CALL));
}

function rowId() {
  return 'row_' + Math.random().toString(36).slice(2, 9);
}

function emptyRow() {
  return { id: rowId(), weekOf: '', unit: '', lesson: '', standard: '', assessmentName: '', assessmentDate: '' };
}

// School years run Jul-Jun, so anything before July belongs to the year that
// started the previous calendar year.
function currentSchoolYearStart() {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

// A date is in range if it falls in Jul(start) .. Jun(start+1).
function outsideSchoolYear(dateStr, startYear) {
  if (!dateStr) return false;
  const m = /^(\d{4})-(\d{2})-/.exec(dateStr);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const expected = mo >= 7 ? startYear : startYear + 1;
  return y !== expected;
}

export default function PacingCalendarReader({ onClose }) {
  const { rollups, pacingEntries, assessments, db } = useApp();

  const [teacherId, setTeacherId] = useState('');
  const [subject, setSubject] = useState('');
  // Anchors undated rows to the right year. District calendars routinely write
  // "8/19-10/18" with no year, and without this the model guessed -- a real
  // 2026-27 Kindergarten calendar came back with 2020, 2023 and 2025 dates.
  const [schoolYear, setSchoolYear] = useState(currentSchoolYearStart);
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
  // Multi-sheet workbooks: every tab, plus which ones are selected for reading.
  const [sheets, setSheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);

  const selectedTeacher = rollups.find((r) => r.teacher.id === teacherId)?.teacher;
  const subjectOptions = selectedTeacher?.subjects || [];
  const outOfRangeCount = weeks.filter(
    (w) => outsideSchoolYear(w.weekOf, schoolYear) || outsideSchoolYear(w.assessmentDate, schoolYear)
  ).length;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setImportedNote(null);
    setExtracting(true);
    try {
      const out = await extractUploadedFile(file);
      if (out.kind === 'pdf') {
        setFileDoc({ fileBase64: out.fileBase64, mediaType: out.mediaType });
        setFileName(out.name);
        setCalendarText('');
        setSheets([]);
        setSelectedSheets([]);
      } else {
        // CSV / Excel / text extracted to plain text: fill the textarea so the
        // coach can review and edit it, and reuse the normal text pipeline.
        setFileDoc(null);
        setFileName(out.name);
        if (out.sheets && out.sheets.length > 1) {
          // Start on the tabs that look like pacing, falling back to all of
          // them if the heuristic matches nothing -- better to cost a few
          // extra calls than to silently read none of the file.
          const suggested = out.sheets.filter(sheetLooksLikePacing).map((s) => s.name);
          const initial = suggested.length ? suggested : out.sheets.map((s) => s.name);
          setSheets(out.sheets);
          setSelectedSheets(initial);
          setCalendarText(joinSheets(out.sheets, initial));
        } else {
          setSheets([]);
          setSelectedSheets([]);
          setCalendarText(out.text);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  function joinSheets(all, names) {
    return all
      .filter((s) => names.includes(s.name))
      .map((s) => `# Sheet: ${s.name}\n${s.text}`)
      .join('\n\n')
      .trim();
  }

  function toggleSheet(name) {
    const next = selectedSheets.includes(name)
      ? selectedSheets.filter((n) => n !== name)
      : [...selectedSheets, name];
    setSelectedSheets(next);
    setCalendarText(joinSheets(sheets, next));
  }

  function setAllSheets(names) {
    setSelectedSheets(names);
    setCalendarText(joinSheets(sheets, names));
  }

  function clearFile() {
    setFileDoc(null);
    setFileName('');
    setSheets([]);
    setSelectedSheets([]);
  }

  async function read() {
    const hasText = calendarText.trim();
    if (!hasText && !fileDoc) return;
    setLoading(true);
    setError(null);
    setImportedNote(null);
    const yearNote = `School year: ${schoolYear}-${schoolYear + 1}. Every date must fall within July ${schoolYear} to June ${schoolYear + 1}.`;
    const context = selectedTeacher
      ? `Teacher: ${selectedTeacher.name}. Subject: ${subject || selectedTeacher.subject || 'n/a'}. Grade: ${
          selectedTeacher.gradeLevel || 'n/a'
        }. ${yearNote}`
      : yearNote;
    try {
      const extracted = await analyzeCalendar(fileDoc ? '' : calendarText, context, fileDoc || undefined);
      setWeeks(extracted.map((w) => ({ id: rowId(), weekOf: '', unit: '', lesson: '', standard: '', assessmentName: '', assessmentDate: '', ...w })));
      setSource('ai');
    } catch (e) {
      if (e.reachable && e.timedOut) {
        // The old copy blamed ANTHROPIC_API_KEY/ANTHROPIC_MODEL for every
        // failure, including this one -- which sent people to check config
        // that was fine. A gateway timeout means the section was too big to
        // read inside the serverless budget, so say that and give the action
        // that actually helps.
        setError(
          'That took too long to read in one pass. Upload or paste a smaller section — one quarter or one unit at a time — and import each in turn.'
        );
      } else if (e.reachable) {
        setError(`Live analysis failed: ${e.message}`);
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

  function clearOutOfRangeDates() {
    setWeeks((rows) =>
      rows.map((r) => ({
        ...r,
        weekOf: outsideSchoolYear(r.weekOf, schoolYear) ? '' : r.weekOf,
        assessmentDate: outsideSchoolYear(r.assessmentDate, schoolYear) ? '' : r.assessmentDate,
      }))
    );
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
      maxWidth={1220}
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

        <Field label="School year" hint="anchors dates written without a year, e.g. &quot;8/19-10/18&quot;">
          <select
            className="select"
            value={schoolYear}
            onChange={(e) => setSchoolYear(Number(e.target.value))}
            style={{ maxWidth: 200 }}
          >
            {[schoolYear - 2, schoolYear - 1, schoolYear, schoolYear + 1, schoolYear + 2]
              .filter((y, i, a) => a.indexOf(y) === i)
              .sort((a, b) => a - b)
              .map((y) => (
                <option key={y} value={y}>
                  {y}-{y + 1}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Upload a file" hint="PDF, Excel (.xlsx/.xls), CSV, or text · max 4MB">
          <input
            className="input"
            type="file"
            accept={UPLOAD_FILE_ACCEPT}
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

        {/* Sheet picker. A district workbook is often mostly tabs that hold no
            pacing at all -- resource-link indexes, blank month grids -- and
            each one still costs model calls and time. Showing the cost per tab
            makes the tradeoff visible instead of it just being slow. */}
        {sheets.length > 1 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row row--between row--wrap" style={{ gap: 8 }}>
              <span className="section-title" style={{ margin: 0 }}>
                Which sheets to read · {sheets.length} in this workbook
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setAllSheets(sheets.filter(sheetLooksLikePacing).map((s) => s.name))}
                  disabled={!sheets.some(sheetLooksLikePacing)}
                >
                  Suggested only
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setAllSheets(sheets.map((s) => s.name))}>
                  All
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setAllSheets([])}>
                  None
                </button>
              </span>
            </div>
            <ul className="checklist">
              {sheets.map((s) => {
                const on = selectedSheets.includes(s.name);
                const suggested = sheetLooksLikePacing(s);
                return (
                  <li key={s.name}>
                    <button
                      type="button"
                      className={`check ${on ? 'check--done' : 'check--todo'}`}
                      onClick={() => toggleSheet(s.name)}
                      aria-pressed={on}
                      aria-label={`${on ? 'Deselect' : 'Select'} sheet ${s.name}`}
                      style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                    >
                      {on ? '✓' : ''}
                    </button>
                    <span
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer', color: on ? 'var(--text-strong)' : 'var(--text-muted)' }}
                      onClick={() => toggleSheet(s.name)}
                    >
                      {s.name}
                      {suggested && (
                        <span className="badge badge--brand" style={{ marginLeft: 8 }}>
                          likely pacing
                        </span>
                      )}
                    </span>
                    <span className="muted small mono" style={{ whiteSpace: 'nowrap' }}>
                      {estimateCalls(s.text.length)} call{estimateCalls(s.text.length) === 1 ? '' : 's'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              {selectedSheets.length} of {sheets.length} selected ·{' '}
              {calendarText.length.toLocaleString()} characters · about{' '}
              {estimateCalls(calendarText.length)} model call
              {estimateCalls(calendarText.length) === 1 ? '' : 's'}
              {selectedSheets.length === 0 && ' — select at least one sheet, or paste text below.'}
            </p>
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

            {/* Dates outside the stated school year are the one error that would
                silently corrupt a record if imported, so they're called out
                above the table rather than left for the coach to spot. */}
            {outOfRangeCount > 0 && (
              <div className="banner banner--warn">
                {outOfRangeCount} row{outOfRangeCount === 1 ? '' : 's'} came back with a date outside{' '}
                {schoolYear}-{schoolYear + 1} (highlighted below). The source likely wrote those dates
                without a year. Correct or clear them before importing.
              </div>
            )}

            {/* The draft exists to be READ before importing, so Unit and
                Standard get real width and the whole thing scrolls sideways
                rather than squeezing seven columns into the modal. Without
                this, a 115-row draft showed "Un" and "K.RL.1, K" and had to be
                clicked into field by field. */}
            <div className="draft-scroll">
            <table className="table table--draft">
              {/* Only the predictable columns get a fixed width; Unit and
                  Standard are left unsized so a fixed table layout splits
                  whatever remains between them, which is where the long text
                  actually is. */}
              <colgroup>
                <col style={{ width: 132 }} />
                <col />
                <col style={{ width: 140 }} />
                <col />
                <col style={{ width: 180 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 76 }} />
              </colgroup>
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
                        style={
                          outsideSchoolYear(w.weekOf, schoolYear)
                            ? { borderColor: 'var(--amber-500)', background: 'var(--amber-surface)' }
                            : undefined
                        }
                        title={outsideSchoolYear(w.weekOf, schoolYear) ? `Outside ${schoolYear}-${schoolYear + 1}` : undefined}
                      />
                    </td>
                    {/* title= so the longest unit names and standards lists,
                        which still outrun even a wide column, can be read on
                        hover instead of only by clicking into the field. */}
                    <td>
                      <input
                        className="input"
                        value={w.unit || ''}
                        title={w.unit || undefined}
                        onChange={(e) => updateWeek(i, { unit: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={w.lesson || ''}
                        title={w.lesson || undefined}
                        onChange={(e) => updateWeek(i, { lesson: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={w.standard || ''}
                        title={w.standard || undefined}
                        onChange={(e) => updateWeek(i, { standard: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={w.assessmentName || ''}
                        title={w.assessmentName || undefined}
                        onChange={(e) => updateWeek(i, { assessmentName: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={w.assessmentDate || ''}
                        onChange={(e) => updateWeek(i, { assessmentDate: e.target.value })}
                        style={
                          outsideSchoolYear(w.assessmentDate, schoolYear)
                            ? { borderColor: 'var(--amber-500)', background: 'var(--amber-surface)' }
                            : undefined
                        }
                        title={
                          outsideSchoolYear(w.assessmentDate, schoolYear) ? `Outside ${schoolYear}-${schoolYear + 1}` : undefined
                        }
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
            </div>
            <button className="btn btn--ghost btn--sm" onClick={addWeek}>
              + Add week
            </button>

            <div className="row row--wrap" style={{ gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={approveAndImport}
                disabled={!teacherId || (subjectOptions.length > 0 && !subject) || outOfRangeCount > 0}
              >
                <Icon name="interventions" /> Approve and Import
              </button>
              {outOfRangeCount > 0 && (
                <>
                  <span className="small muted">
                    Fix the {outOfRangeCount} highlighted date{outOfRangeCount === 1 ? '' : 's'} to import.
                  </span>
                  {/* Bulk escape hatch: on a big calendar, clearing the bad dates by
                      hand is dozens of clicks. A null date is safe -- rows without
                      one are skipped on import rather than saved wrong. */}
                  <button className="btn btn--ghost btn--sm" onClick={clearOutOfRangeDates}>
                    Clear the {outOfRangeCount} bad date{outOfRangeCount === 1 ? '' : 's'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {importedNote && <div className="banner banner--info">{importedNote}</div>}
      </div>
    </Modal>
  );
}
