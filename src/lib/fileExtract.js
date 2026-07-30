// ---------------------------------------------------------------------------
// Client-side file extraction shared by the AI readers (Pacing Calendar and
// Lesson Plan).
//
// Every supported file is turned into plain text in the browser, then flows
// through the same reader pipeline as pasted text (live function when deployed,
// offline demo read otherwise). Nothing is uploaded to a function here, so
// there is no payload-size ceiling and uploads work in local dev too.
//   - CSV / TSV / TXT -> read straight to text
//   - Excel (.xlsx/.xls) -> parsed to CSV text with SheetJS
//   - PDF -> text extracted with pdf.js
// SheetJS and pdf.js are loaded on demand from their ESM CDNs, so nothing is
// added to the bundle or the lockfile.
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024; // 4MB

export const UPLOAD_FILE_ACCEPT =
  '.csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,text/tab-separated-values,text/plain,' +
  'application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel';

// SheetJS left npm; its ESM build is distributed from this CDN. The imports are
// runtime strings so Vite/Rollup leave them as native dynamic imports rather
// than trying to bundle them, and they only load when such a file is chosen.
const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

let sheetJsPromise = null;
function loadSheetJS() {
  if (!sheetJsPromise) {
    sheetJsPromise = import(/* @vite-ignore */ SHEETJS_CDN).then((mod) =>
      mod && mod.read ? mod : mod.default || mod
    );
  }
  return sheetJsPromise;
}

let pdfJsPromise = null;
function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(/* @vite-ignore */ PDFJS_CDN).then((mod) => {
      const lib = mod && mod.getDocument ? mod : mod.default || mod;
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfJsPromise;
}

function extOf(name) {
  const i = (name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

// Splits one delimited line, respecting "quoted, fields" and "" escapes.
function splitRow(line, delim) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

function joinRow(cells, delim) {
  return cells
    .map((c) => (c.includes(delim) || c.includes('"') || c.includes('\n') ? `"${c.replace(/"/g, '""')}"` : c))
    .join(delim);
}

// Spreadsheets carry a lot of layout that means nothing to a reader: spacer
// columns, merged-cell padding, and blank rows all survive sheet_to_csv as
// runs of bare delimiters (",,,,K,," and '"""""' in a real district
// calendar). That padding is pure cost -- it inflates the character count
// that decides how many model calls a file needs, and it makes each call
// slower for no added meaning, which is what pushed a full-year calendar
// past the serverless timeout into a 504. Dropping all-empty rows and
// columns is lossless for the reader and typically cuts the payload by more
// than half.
export function tidyTabularText(text, delim = ',') {
  if (!text) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const rows = lines.map((l) => splitRow(l, delim));

  // A column is dead if every row leaves it blank.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const liveCols = [];
  for (let c = 0; c < width; c += 1) {
    if (rows.some((r) => (r[c] || '').trim() !== '')) liveCols.push(c);
  }

  const out = [];
  for (const row of rows) {
    const kept = liveCols.map((c) => (row[c] || '').trim());
    // Drop trailing blanks so short rows don't carry a tail of delimiters.
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    if (kept.length === 0) {
      // Collapse any run of blank rows into a single separator.
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(joinRow(kept, delim));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

function readAsUint8Array(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsArrayBuffer(file);
  });
}

async function extractExcelText(file) {
  let XLSX;
  try {
    XLSX = await loadSheetJS();
  } catch {
    throw new Error(
      'Could not load the spreadsheet reader. Check your connection, or save the sheet as CSV and upload that.'
    );
  }
  const bytes = await readAsUint8Array(file);
  const workbook = XLSX.read(bytes, { type: 'array' });
  // Per-sheet as well as merged: a district workbook is routinely 15 tabs of
  // which two hold pacing and the rest are resource-link indexes and blank
  // month grids. Reading all of them costs a model call per ~1200 characters
  // and returns nothing for most, so the caller gets the breakdown and can
  // read only what matters. See sheetLooksLikePacing below.
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    text: tidyTabularText(XLSX.utils.sheet_to_csv(workbook.Sheets[name])),
  })).filter((s) => s.text.trim());

  const text = sheets
    .map((s) => (sheets.length > 1 ? `# Sheet: ${s.name}\n${s.text}` : s.text))
    .join('\n\n')
    .trim();
  if (!text) throw new Error(`${file.name} has no readable rows.`);
  return { text, sheets };
}

// Heuristic for pre-selecting which tabs of a multi-sheet workbook are worth
// reading. It only sets the default -- the picker lists every sheet and the
// coach can override -- and when it matches nothing the caller selects all,
// so a miss costs calls rather than data.
//
// Measured against a real 15-tab district workbook, the discriminator is the
// density of STANDARDS CODES. The two tabs that actually hold pacing carried
// 108 and 21 of them; the resource-link index and all eleven month grids
// carried none. Word cues alone are useless here: the resource index says
// "module" 403 times and a blank month grid still contains month names, which
// is why an earlier version of this selected 12 of 14 tabs.
//
// A few codes rather than one, so a stray match doesn't pull in a whole tab.
// The date-based alternative catches a pacing tab that lists dated units but
// no standards; month grids fail it because their dates are bare grid numbers
// rather than m/d pairs.
const STANDARDS_CODE = /\b[a-z]{1,3}\.[a-z]{1,3}\.?\d+[a-z]?\b/g;
const UNIT_WORD = /\b(unit|module|cycle|lesson)\b/g;
const MD_DATE = /\b\d{1,2}\/\d{1,2}\b/g;

function countOf(text, re) {
  return (text.match(re) || []).length;
}

export function sheetLooksLikePacing(sheet) {
  const t = (sheet.text || '').toLowerCase();
  if (countOf(t, STANDARDS_CODE) >= 3) return true;
  return countOf(t, UNIT_WORD) >= 3 && countOf(t, MD_DATE) >= 3;
}

async function extractPdfText(file) {
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    throw new Error(
      'Could not load the PDF reader. Check your connection, or copy the calendar text and paste it instead.'
    );
  }
  const bytes = await readAsUint8Array(file);
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
  }
  const text = pages.join('\n').trim();
  if (!text) {
    throw new Error(
      `${file.name} has no selectable text (it may be a scan). Paste the calendar text instead.`
    );
  }
  return text;
}

// Resolves to { kind: 'text', text, name }. All supported formats are reduced
// to text so the caller has a single path to handle.
export async function extractUploadedFile(file) {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 4MB. Trim it, or paste the text instead.`);
  }

  const ext = extOf(file.name);
  const type = file.type || '';

  if (ext === 'pdf' || type === 'application/pdf') {
    return { kind: 'text', text: await extractPdfText(file), name: file.name };
  }

  if (ext === 'xlsx' || ext === 'xls' || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel') {
    // `sheets` is extra: callers that only want the whole thing (the Lesson
    // Plan reader) keep using `text` unchanged.
    const { text, sheets } = await extractExcelText(file);
    return { kind: 'text', text, sheets, name: file.name };
  }

  // csv, tsv, txt, or anything else that reads as text
  const raw = (await readAsText(file)).trim();
  if (!raw) throw new Error(`${file.name} is empty.`);
  // Delimited files get the same padding removed as spreadsheets; .txt is
  // left alone since it has no column structure to reason about.
  const text =
    ext === 'csv' ? tidyTabularText(raw, ',') : ext === 'tsv' ? tidyTabularText(raw, '\t') : raw;
  if (!text) throw new Error(`${file.name} has no readable rows.`);
  return { kind: 'text', text, name: file.name };
}
