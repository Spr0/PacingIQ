// ---------------------------------------------------------------------------
// Attachment storage client helper.
//
// File bytes live in Netlify Blobs via the upload/get/delete-attachment
// functions, not in localStorage. Observation records keep only the blob
// key and lightweight metadata (name, type, sizeKB, uploadedAt).
//
// All three endpoints verify the caller's Supabase session, so every request
// here carries the access token.
// ---------------------------------------------------------------------------

import { authHeaders } from './functionAuth.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export async function uploadAttachment(file, teacherId, observationId) {
  const form = new FormData();
  form.append('file', file);
  form.append('teacherId', teacherId);
  form.append('observationId', observationId);

  // Not spread into a Content-Type: FormData sets its own multipart boundary.
  const headers = await authHeaders();

  let res;
  try {
    res = await fetch('/.netlify/functions/upload-attachment', { method: 'POST', headers, body: form });
  } catch {
    const err = new Error('Attachment storage function is not reachable.');
    err.reachable = false;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const err = new Error('Attachment storage function is not deployed here.');
    err.reachable = false;
    throw err;
  }

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.detail || data.error || `Upload failed (${res.status})`);
    err.reachable = true;
    throw err;
  }
  return data;
}

export async function deleteAttachment(key) {
  if (!key) return;
  try {
    await fetch(`/.netlify/functions/delete-attachment?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
  } catch {
    // Best-effort cleanup; a failed delete just leaves an orphaned blob.
    // authHeaders() throwing on a dead session lands here too, which is the
    // right outcome: there is nothing useful to tell the coach about a blob
    // she is discarding anyway.
  }
}

// Fetches the bytes and hands back an object URL the caller must revoke.
//
// This used to be attachmentUrl(), a plain string dropped into href -- but a
// browser navigating to a URL cannot attach an Authorization header, and
// get-attachment now requires one. Putting a token in the query string instead
// would leak it into history and any intermediate log, so the fetch happens in
// JS and the resulting blob is what the link points at.
export async function fetchAttachmentUrl(key) {
  const res = await fetch(`/.netlify/functions/get-attachment?key=${encodeURIComponent(key)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch {
      /* non-JSON body: the SPA catch-all, or a gateway error page */
    }
    throw new Error(detail || `Could not open that file (${res.status}).`);
  }
  return URL.createObjectURL(await res.blob());
}
