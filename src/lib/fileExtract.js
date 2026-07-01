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
  const text = workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    return workbook.SheetNames.length > 1 ? `# Sheet: ${name}\n${csv}` : csv;
  })
    .join('\n\n')
    .trim();
  if (!text) throw new Error(`${file.name} has no readable rows.`);
  return text;
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
    return { kind: 'text', text: await extractExcelText(file), name: file.name };
  }

  // csv, tsv, txt, or anything else that reads as text
  const text = (await readAsText(file)).trim();
  if (!text) throw new Error(`${file.name} is empty.`);
  return { kind: 'text', text, name: file.name };
}
