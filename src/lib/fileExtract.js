// ---------------------------------------------------------------------------
// Client-side file extraction for the Pacing Calendar Reader.
//
// Turns an uploaded pacing calendar into something the AI reader can consume:
//   - CSV / TSV / TXT  -> read straight to text (no dependency)
//   - Excel (.xlsx/.xls) -> parsed to CSV text with SheetJS, loaded on demand
//       from its official ESM CDN so nothing is added to the bundle or lockfile
//   - PDF -> returned as base64 for the serverless function to hand to Claude as
//       a native document block (no brittle client-side PDF text extraction)
//
// Text-kind results flow through the existing paste pipeline (and its offline
// demo fallback); PDF-kind results require the live model to read the document.
// ---------------------------------------------------------------------------

export const MAX_CALENDAR_FILE_BYTES = 4 * 1024 * 1024; // 4MB, well under the function body limit

export const CALENDAR_FILE_ACCEPT =
  '.csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,text/tab-separated-values,text/plain,' +
  'application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel';

// SheetJS left npm; its ESM build is distributed from this CDN. The import is a
// runtime string so Vite/Rollup leave it as a native dynamic import rather than
// trying to bundle it, and it only loads when a spreadsheet is actually chosen.
const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let sheetJsPromise = null;
function loadSheetJS() {
  if (!sheetJsPromise) {
    sheetJsPromise = import(/* @vite-ignore */ SHEETJS_CDN);
  }
  return sheetJsPromise;
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

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsArrayBuffer(file);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1)); // strip the data: URL prefix
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// Resolves to { kind: 'text', text, name } or { kind: 'pdf', fileBase64, mediaType, name }.
export async function extractCalendarFile(file) {
  if (file.size > MAX_CALENDAR_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 4MB. Trim it, or paste the text instead.`);
  }

  const ext = extOf(file.name);
  const type = file.type || '';

  if (ext === 'pdf' || type === 'application/pdf') {
    const fileBase64 = await readAsBase64(file);
    return { kind: 'pdf', fileBase64, mediaType: 'application/pdf', name: file.name };
  }

  if (ext === 'xlsx' || ext === 'xls' || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel') {
    let XLSX;
    try {
      XLSX = await loadSheetJS();
    } catch {
      throw new Error(
        'Could not load the spreadsheet reader. Check your connection, or save the sheet as CSV and upload that.'
      );
    }
    const buffer = await readAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: 'array' });
    const text = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return workbook.SheetNames.length > 1 ? `# Sheet: ${name}\n${csv}` : csv;
    })
      .join('\n\n')
      .trim();
    if (!text) throw new Error(`${file.name} has no readable rows.`);
    return { kind: 'text', text, name: file.name };
  }

  // csv, tsv, txt, or anything else that reads as text
  const text = (await readAsText(file)).trim();
  if (!text) throw new Error(`${file.name} is empty.`);
  return { kind: 'text', text, name: file.name };
}
