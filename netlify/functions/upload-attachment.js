// ---------------------------------------------------------------------------
// Attachment Upload — Netlify Function.
//
// Accepts a multipart/form-data POST (file + teacherId + observationId) and
// stores the file in Netlify Blobs. Only PDF/JPG/PNG/WEBP are accepted, up to
// 10MB. Returns the blob key and file metadata; the caller stores those on
// the observation record instead of embedding file bytes anywhere.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { parseMultipart } = require('./_shared/multipart.js');

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Expected multipart/form-data' }) };
    }

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '', 'binary');

    const parts = parseMultipart(bodyBuffer, contentType);

    const fields = {};
    let filePart = null;
    for (const part of parts) {
      if (part.filename) {
        filePart = part;
      } else if (part.name) {
        fields[part.name] = part.data.toString('utf8');
      }
    }

    const teacherId = fields.teacherId;
    const observationId = fields.observationId;

    if (!teacherId || !observationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'teacherId and observationId are required' }),
      };
    }
    if (!filePart || !filePart.data.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'file is required' }) };
    }
    if (!ALLOWED_TYPES.has(filePart.contentType)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Unsupported file type. Allowed: PDF, JPG, PNG, WEBP',
          detail: filePart.contentType || 'unknown',
        }),
      };
    }
    if (filePart.data.length > MAX_BYTES) {
      return { statusCode: 400, body: JSON.stringify({ error: 'File exceeds 10MB limit' }) };
    }

    const safeName = sanitizeFilename(filePart.filename);
    const uploadedAt = new Date().toISOString();
    const key = `${teacherId}/${observationId}/${crypto.randomUUID()}-${safeName}`;

    const store = getStore('attachments');
    await store.set(key, filePart.data, {
      metadata: {
        name: safeName,
        type: filePart.contentType,
        size: filePart.data.length,
        teacherId,
        observationId,
        uploadedAt,
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        name: safeName,
        type: filePart.contentType,
        sizeKB: Math.max(1, Math.round(filePart.data.length / 1024)),
        uploadedAt,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Upload failed', detail: err.message }),
    };
  }
};
