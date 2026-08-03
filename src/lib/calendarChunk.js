// ---------------------------------------------------------------------------
// Splitting a pacing calendar into model-sized pieces.
//
// Pure text handling, kept separate from calendarReader.js so it can be tested
// without dragging in the Supabase client. This is where a real district PDF
// stopped working: extractPdfText renders a PDF as one line per page, and
// nothing here could subdivide a single line, so a text-heavy page went to the
// model whole -- several times the measured-safe size -- and timed out every
// time, with no smaller section the coach could pick that would help.
// ---------------------------------------------------------------------------

// Splits one line that is itself bigger than the budget. Prefers a sentence
// end, then any space, then a hard cut -- a prose-heavy calendar page should
// break somewhere a reader would break it, not mid-word.
export function splitLongLine(line, budget) {
  const out = [];
  let rest = line;
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    let cut = -1;
    const sentence = window.lastIndexOf('. ');
    if (sentence > budget * 0.5) cut = sentence + 1;
    if (cut < 0) {
      const space = window.lastIndexOf(' ');
      if (space > budget * 0.5) cut = space;
    }
    if (cut < 0) cut = budget; // one unbroken run of characters; cut it
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// A short first line (a title or CSV header) is repeated on every chunk so each
// one keeps its column context.
export function chunkCalendar(text, maxChars) {
  if (!text || text.length <= maxChars) return [text || ''];
  const lines = text.split('\n');
  const header = lines.length > 1 && lines[0].length <= 300 ? lines[0] : '';
  const body = header ? lines.slice(1) : lines;
  const budget = Math.max(500, maxChars - (header ? header.length + 1 : 0));

  // Pre-split anything longer than the budget. The accumulator below only ever
  // starts a new chunk BETWEEN lines -- `cur &&` is false on the first one --
  // so without this an over-long line passes through whole.
  const units = [];
  for (const line of body) {
    if (line.length > budget) units.push(...splitLongLine(line, budget));
    else units.push(line);
  }

  const chunks = [];
  let cur = '';
  for (const unit of units) {
    if (cur && cur.length + unit.length + 1 > budget) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + unit;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => (header ? `${header}\n${c}` : c));
}
