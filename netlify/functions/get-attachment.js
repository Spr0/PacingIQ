// ---------------------------------------------------------------------------
// Attachment Fetch — Netlify Function.
//
// Streams a previously uploaded attachment back from Netlify Blobs given its
// key, with the original Content-Type and filename restored from metadata
// recorded at upload time.
//
// Read access is whatever RLS grants on the owning observation, asked with the
// caller's own token. An unsaved draft has no observation row yet, so those
// fall back to "you uploaded it" -- which is also what lets the coach preview a
// file she has just attached but not yet saved.
// ---------------------------------------------------------------------------

const { getStore } = require('@netlify/blobs');
const { authenticate, loadObservation, json } = require('./_shared/auth.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key) return json(400, { error: 'key is required' });

  try {
    const store = getStore('attachments');
    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!result) return json(404, { error: 'Not found' });

    const buffer = Buffer.from(result.data);
    const metadata = result.metadata || {};

    const observation = await loadObservation(auth.token, metadata.observationId);
    const allowed = observation ? true : metadata.uploadedBy === auth.user.id;
    if (!allowed) {
      return json(403, { error: 'You do not have access to this attachment.' });
    }

    const filename = (metadata.name || 'download').replace(/"/g, '');
    const contentType = metadata.type || 'application/octet-stream';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        // The body now depends on who asked, so it must not sit in any cache
        // that a different caller could be served from.
        'Cache-Control': 'no-store',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return json(500, { error: 'Fetch failed', detail: err.message });
  }
};
