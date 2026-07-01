// ---------------------------------------------------------------------------
// Attachment Fetch — Netlify Function.
//
// Streams a previously uploaded attachment back from Netlify Blobs given its
// key, with the original Content-Type and filename restored from metadata
// recorded at upload time.
// ---------------------------------------------------------------------------

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key) {
    return { statusCode: 400, body: JSON.stringify({ error: 'key is required' }) };
  }

  try {
    const store = getStore('attachments');
    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!result) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    }

    const buffer = Buffer.from(result.data);
    const metadata = result.metadata || {};
    const filename = (metadata.name || 'download').replace(/"/g, '');
    const contentType = metadata.type || 'application/octet-stream';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Fetch failed', detail: err.message }),
    };
  }
};
