// ---------------------------------------------------------------------------
// Attachment storage client helper.
//
// File bytes live in Netlify Blobs via the upload/get/delete-attachment
// functions, not in localStorage. Observation records keep only the blob
// key and lightweight metadata (name, type, sizeKB, uploadedAt).
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export async function uploadAttachment(file, teacherId, observationId) {
  const form = new FormData();
  form.append('file', file);
  form.append('teacherId', teacherId);
  form.append('observationId', observationId);

  let res;
  try {
    res = await fetch('/.netlify/functions/upload-attachment', { method: 'POST', body: form });
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
    });
  } catch {
    // Best-effort cleanup; a failed delete just leaves an orphaned blob.
  }
}

export function attachmentUrl(key) {
  return `/.netlify/functions/get-attachment?key=${encodeURIComponent(key)}`;
}
