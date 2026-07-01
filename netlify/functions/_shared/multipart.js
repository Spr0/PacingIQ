// ---------------------------------------------------------------------------
// Minimal multipart/form-data parser for Netlify Functions.
//
// Files starting with an underscore are not deployed as functions, so this
// stays a shared helper rather than an endpoint. Only handles what the
// attachment upload needs: a handful of text fields plus one file part.
// ---------------------------------------------------------------------------

function parseMultipart(bodyBuffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;
  if (!boundary) throw new Error('Missing multipart boundary');

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const rawParts = [];
  let start = bodyBuffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    const nextStart = bodyBuffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (nextStart === -1) break;
    let chunk = bodyBuffer.slice(start + boundaryBuffer.length, nextStart);
    if (chunk.slice(0, 2).toString('utf8') === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString('utf8') === '\r\n') chunk = chunk.slice(0, -2);
    if (chunk.length) rawParts.push(chunk);
    start = nextStart;
  }

  return rawParts.map((part) => {
    const headerEnd = part.indexOf('\r\n\r\n');
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);

    const dispositionMatch = /Content-Disposition:\s*form-data;\s*(.*)/i.exec(headerText);
    const params = {};
    if (dispositionMatch) {
      const paramRegex = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = paramRegex.exec(dispositionMatch[1]))) {
        params[m[1]] = m[2];
      }
    }
    const typeMatch = /Content-Type:\s*(.+)/i.exec(headerText);

    return {
      name: params.name || null,
      filename: params.filename || null,
      contentType: typeMatch ? typeMatch[1].trim() : null,
      data,
    };
  });
}

module.exports = { parseMultipart };
