// ---------------------------------------------------------------------------
// Attachment Delete — Netlify Function.
//
// Removes a previously uploaded attachment from Netlify Blobs by key.
//
// Mirrors canEditRecord() in src/lib/permissions.js rather than the coach-only
// delete rule: removing a file while editing your own write-up is an edit, not
// a record deletion. Deleting the observation itself is still coach-only, and
// that path is gated by RLS before it ever gets here.
//
// The unsaved-draft case matters: Observations.jsx uploads files as they are
// chosen and cleans up the blobs if the coach cancels, so at that point there
// is no observation row to check against. Those fall back to "you uploaded
// it", recorded in blob metadata at upload time.
// ---------------------------------------------------------------------------

const { getStore } = require('@netlify/blobs');
const { authenticate, loadObservation, json } = require('./_shared/auth.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key) return json(400, { error: 'key is required' });

  try {
    const store = getStore('attachments');
    const existing = await store.getMetadata(key);
    if (!existing) return json(404, { error: 'Not found' });

    const metadata = existing.metadata || {};
    const observation = await loadObservation(auth.token, metadata.observationId);

    const allowed = observation
      ? auth.role === 'coach' || observation.created_by_id === auth.user.id
      : metadata.uploadedBy === auth.user.id;
    if (!allowed) {
      return json(403, { error: 'You can only remove attachments on your own observations.' });
    }

    await store.delete(key);
    return json(200, { deleted: true, key });
  } catch (err) {
    return json(500, { error: 'Delete failed', detail: err.message });
  }
};
