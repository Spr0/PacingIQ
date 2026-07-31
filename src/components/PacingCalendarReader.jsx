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

import { useRef, useState } from 'react';
import { Modal, Field } from './ui.jsx';
import { Icon } from './icons.jsx';
import { useApp } from '../state/AppContext.jsx';
import { analyzeCalendar, localCalendarAnalysis } from '../lib/calendarReader.js';
import { extractUploadedFile, sheetLooksLikePacing, UPLOAD_FILE_ACCEPT } from '../lib/fileExtract.js';
import { planCalendarImport } from '../lib/calendarImport.js';

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

  // A grade-level team shares one scope-and-sequence, so the same reviewed draft
  // usually needs to land on several teachers. Reading it once and importing to
  // all of them costs one set of model calls instead of one per teacher.
  const [teacherIds, setTeacherIds] = useState([]);
  const [teacherFilter, setTeacherFilter] = useState('');
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
  const [importing, setImporting] = useState(false);
  // A re-import across a whole team can be hundreds of sequential writes, each
  // reloading the store. Without a running count that reads as a hung modal.
  const [importProgress, setImportProgress] = useState(null);
  // Set when a function rejects a request this tab is too old to make properly.
  const [staleBundle, setStaleBundle] = useState(false);
  // Multi-sheet workbooks: every tab, plus which ones are selected for reading.
  const [sheets, setSheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);

  const allTeachers = rollups.map((r) => r.teacher);
  const selectedTeachers = allTeachers.filter((t) => teacherIds.includes(t.id));
  const visibleTeachers = teacherFilter.trim()
    ? allTeachers.filter((t) => t.name.toLowerCase().includes(teacherFilter.trim().toLowerCase()))
    : allTeachers;

  // The union across everyone selected, not the intersection: a team is often
  // one teacher tagged [ELA, Math] alongside others tagged [ELA] only, and an
  // intersection would hide the very subject they share.
  const subjectOptions = [...new Set(selectedTeachers.flatMap((t) => t.subjects || []))];
  // Whoever is selected but doesn't list the chosen subject. Not an error --
  // subject tagging is patchy and the coach knows her own team -- but she
  // should see it before it becomes a row filed under the wrong heading.
  const subjectMismatches = subject
    ? selectedTeachers.filter((t) => (t.subjects || []).length > 0 && !(t.subjects || []).includes(subject))
    : [];

  const outOfRangeCount = weeks.filter(
    (w) => outsideSchoolYear(w.weekOf, schoolYear) || outsideSchoolYear(w.assessmentDate, schoolYear)
  ).length;

  // Teacher and Subject sit at the top of the modal, and a year-long import
  // puts a hundred-odd draft rows between them and the Approve button. So a
  // coach who skipped one scrolls to the bottom, finds a greyed-out button, and
  // has nothing telling her why -- only the out-of-range case ever explained
  // itself. Every reason is named here, next to the button, with a control that
  // jumps back to the field that needs filling.
  const teacherRef = useRef(null);
  const subjectRef = useRef(null);

  const blockers = [];
  if (selectedTeachers.length === 0) {
    blockers.push({ text: 'No teacher chosen yet.', action: 'Choose a teacher', ref: teacherRef });
  } else if (subjectOptions.length > 0 && !subject) {
    blockers.push({
      text:
        selectedTeachers.length === 1
          ? `${selectedTeachers[0].name} covers more than one subject, so the import needs to know which one.`
          : 'The teachers selected cover more than one subject between them, so the import needs to know which one.',
      action: 'Choose a subject',
      ref: subjectRef,
    });
  }
  if (outOfRangeCount > 0) {
    blockers.push({
      text: `${outOfRangeCount} highlighted date${outOfRangeCount === 1 ? '' : 's'} fall outside ${schoolYear}-${schoolYear + 1}.`,
    });
  }

  function selectTeachers(ids) {
    setTeacherIds(ids);
    // Subject options are derived from who is selected, so a subject nobody
    // selected offers any more must not survive as a stale value on the import.
    const stillOffered = new Set(
      allTeachers.filter((t) => ids.includes(t.id)).flatMap((t) => t.subjects || [])
    );
    if (subject && !stillOffered.has(subject)) setSubject('');
  }

  function toggleTeacher(id) {
    selectTeachers(teacherIds.includes(id) ? teacherIds.filter((x) => x !== id) : [...teacherIds, id]);
  }

  function jumpTo(ref) {
    const el = ref?.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }

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
    // One calendar read serves every selected teacher, so the context describes
    // the group. Grade is only stated when they all share one -- naming a grade
    // that only some of them teach would invite the model to lean on it.
    const grades = [...new Set(selectedTeachers.map((t) => t.gradeLevel).filter(Boolean))];
    const context = selectedTeachers.length
      ? [
          selectedTeachers.length === 1
            ? `Teacher: ${selectedTeachers[0].name}.`
            : `Teachers (${selectedTeachers.length}, sharing this calendar): ${selectedTeachers.map((t) => t.name).join(', ')}.`,
          `Subject: ${subject || selectedTeachers[0].subject || 'n/a'}.`,
          `Grade: ${grades.length === 1 ? grades[0] : 'n/a'}.`,
          yearNote,
        ].join(' ')
      : yearNote;
    try {
      const extracted = await analyzeCalendar(fileDoc ? '' : calendarText, context, fileDoc || undefined);
      setWeeks(extracted.map((w) => ({ id: rowId(), weekOf: '', unit: '', lesson: '', standard: '', assessmentName: '', assessmentDate: '', ...w })));
      setSource('ai');
    } catch (e) {
      if (e.staleBundle) {
        // Nothing here can be retried until the page is reloaded, so say only
        // that and give the button rather than dressing it as an AI failure.
        setStaleBundle(true);
        setError(e.message);
      } else if (e.reachable && e.timedOut) {
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

  // Awaited and batched. This previously fired every write off without waiting:
  // dozens of separate inserts, each with its own audit entry and a full
  // ten-table reload, any failure silently swallowed, the reported counts
  // describing what was attempted rather than what landed -- and the modal
  // stayed open afterwards, so there was no sign it had worked at all.
  //
  // The same reviewed draft is applied to every selected teacher. The planning
  // lives in lib/calendarImport.js so it can be tested on its own.
  async function approveAndImport() {
    if (blockers.length > 0 || importing) return;

    const { toInsert, toUpdate, newAssessments } = planCalendarImport({
      weeks,
      teachers: selectedTeachers,
      subject,
      pacingEntries,
      assessments,
    });

    setImporting(true);
    setError(null);
    setImportedNote(null);
    setImportProgress(null);
    try {
      const audit =
        selectedTeachers.length === 1
          ? 'imported pacing calendar with AI'
          : `imported pacing calendar with AI for ${selectedTeachers.length} teachers`;
      // Updates are one request each; inserts go in a single batch across every
      // teacher, so a team import is not N times the round trips.
      for (let i = 0; i < toUpdate.length; i++) {
        setImportProgress(`Updating existing week ${i + 1} of ${toUpdate.length}…`);
        await db.update('pacingEntries', toUpdate[i].id, toUpdate[i].patch, audit);
      }
      if (toInsert.length) setImportProgress(`Writing ${toInsert.length} pacing weeks…`);
      await db.insertMany('pacingEntries', toInsert, audit);
      if (newAssessments.length) setImportProgress(`Writing ${newAssessments.length} assessments…`);
      await db.insertMany('assessments', newAssessments, audit);

      const weekCount = toInsert.length + toUpdate.length;
      const who =
        selectedTeachers.length === 1
          ? selectedTeachers[0].name
          : `${selectedTeachers.length} teachers (${selectedTeachers.map((t) => t.name).join(', ')})`;
      setImportedNote(
        `Imported ${weekCount} pacing week${weekCount === 1 ? '' : 's'} and ${newAssessments.length} assessment${
          newAssessments.length === 1 ? '' : 's'
        } across ${who}. You can close this window.`
      );
      setWeeks([]); // the draft has been consumed; nothing left to review
    } catch (err) {
      if (err.staleBundle) setStaleBundle(true);
      setError(err.message || 'Some of that did not import. Nothing was changed for the rows that failed.');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
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

        {/* Teacher picker. A filter box rather than a bare list of fifty, and
            the same checklist shape as the sheet picker further down so the two
            multi-selects in this modal behave alike. */}
        <Field
          label={`Teachers${teacherIds.length ? ` · ${teacherIds.length} selected` : ''}`}
          hint="one calendar can be imported to a whole grade-level team at once"
        >
          <input
            className="input"
            ref={teacherRef}
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            placeholder="Filter by name…"
          />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row row--between row--wrap" style={{ gap: 8 }}>
            <span className="small muted">
              {visibleTeachers.length} of {allTeachers.length} shown
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => selectTeachers([...new Set([...teacherIds, ...visibleTeachers.map((t) => t.id)])])}
                disabled={visibleTeachers.length === 0}
              >
                Select these
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => selectTeachers([])}
                disabled={teacherIds.length === 0}
              >
                Clear
              </button>
            </span>
          </div>
          <ul className="checklist" style={{ maxHeight: 210, overflowY: 'auto' }}>
            {visibleTeachers.map((t) => {
              const on = teacherIds.includes(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`check ${on ? 'check--done' : 'check--todo'}`}
                    onClick={() => toggleTeacher(t.id)}
                    aria-pressed={on}
                    aria-label={`${on ? 'Deselect' : 'Select'} ${t.name}`}
                    style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
                  >
                    {on ? '✓' : ''}
                  </button>
                  <span
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer', color: on ? 'var(--text-strong)' : 'var(--text-muted)' }}
                    onClick={() => toggleTeacher(t.id)}
                  >
                    {t.name}
                    {t.gradeLevel && <span className="muted small" style={{ marginLeft: 8 }}>{t.gradeLevel}</span>}
                  </span>
                  <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
                    {(t.subjects || []).join(', ')}
                  </span>
                </li>
              );
            })}
            {visibleTeachers.length === 0 && (
              <li>
                <span className="muted small">No teacher matches “{teacherFilter}”.</span>
              </li>
            )}
          </ul>
        </div>

        {subjectOptions.length > 0 && (
          <Field
            label="Subject"
            hint={
              selectedTeachers.length === 1
                ? 'this teacher covers multiple subjects'
                : 'applied to every teacher selected'
            }
          >
            <select
              className="select"
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ maxWidth: 320 }}
            >
              <option value="">Select a subject</option>
              {subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
        {subjectMismatches.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            {subjectMismatches.map((t) => t.name).join(', ')}{' '}
            {subjectMismatches.length === 1 ? 'is not tagged' : 'are not tagged'} for {subject}. The import
            will still file it under {subject} for {subjectMismatches.length === 1 ? 'them' : 'all of them'}.
          </p>
        )}

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

        {error && (
          <div className="banner banner--danger">
            <div>{error}</div>
            {staleBundle && (
              <button
                className="btn btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => window.location.reload()}
              >
                Reload PacingIQ
              </button>
            )}
          </div>
        )}

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

            {blockers.length > 0 && (
              <div className="banner banner--warn">
                <div style={{ marginBottom: 6 }}>
                  The draft is ready, but the import needs{' '}
                  {blockers.length === 1 ? 'one more thing' : `${blockers.length} more things`}:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {blockers.map((b) => (
                    <li key={b.text} style={{ marginBottom: 4 }}>
                      {b.text}{' '}
                      {b.ref && (
                        <button className="btn btn--ghost btn--sm" onClick={() => jumpTo(b.ref)}>
                          {b.action}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="row row--wrap" style={{ gap: 10 }}>
              <button
                className="btn btn--primary"
                onClick={approveAndImport}
                disabled={blockers.length > 0 || importing}
              >
                <Icon name="interventions" />{' '}
                {importing
                  ? 'Importing…'
                  : selectedTeachers.length > 1
                    ? `Approve and Import for ${selectedTeachers.length} teachers`
                    : 'Approve and Import'}
              </button>
              {importing && importProgress && (
                <span className="small muted">{importProgress}</span>
              )}
              {outOfRangeCount > 0 && (
                /* Bulk escape hatch: on a big calendar, clearing the bad dates by
                   hand is dozens of clicks. A null date is safe -- rows without
                   one are skipped on import rather than saved wrong. */
                <button className="btn btn--ghost btn--sm" onClick={clearOutOfRangeDates}>
                  Clear the {outOfRangeCount} bad date{outOfRangeCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>
        )}

        {importedNote && <div className="banner banner--info">{importedNote}</div>}
      </div>
    </Modal>
  );
}
