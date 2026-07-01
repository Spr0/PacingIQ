// ---------------------------------------------------------------------------
// Attachment Delete — Netlify Function.
//
// Removes a previously uploaded attachment from Netlify Blobs by key.
// ---------------------------------------------------------------------------

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'DELETE') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key) {
    return { statusCode: 400, body: JSON.stringify({ error: 'key is required' }) };
  }

  try {
    const store = getStore('attachments');
    await store.delete(key);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted: true, key }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Delete failed', detail: err.message }),
    };
  }
};
