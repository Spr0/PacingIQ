// ---------------------------------------------------------------------------
// Logging many observations at once (the "Log visits" batch screen).
//
// A batch is one set of shared values plus one row per teacher. A row inherits
// every shared value unless it overrides that field; an override is stored by
// key presence, so a row can deliberately blank a shared value for one teacher
// (an empty string that is present still wins over the shared text).
//
// Kept free of React and Supabase so the record-building logic can be tested
// on its own under node.
// ---------------------------------------------------------------------------

// Every per-visit field a batch can set, in form order. Action items are
// shared-only and handled separately; attachments are never part of a batch
// because a blob is filed under one record and deleting either record would
// delete it for both.
export const BATCH_FIELDS = [
  'date',
  'time',
  'lessonObserved',
  'standard',
  'evidenceOfLearning',
  'teacherActions',
  'studentActions',
  'strengths',
  'areasForGrowth',
  'feedbackProvided',
  'followUpObservationDate',
];

export function emptyShared(date) {
  const shared = {};
  BATCH_FIELDS.forEach((f) => {
    shared[f] = '';
  });
  shared.date = date || '';
  shared.actionItems = [];
  return shared;
}

export function newRow(teacherId) {
  return { teacherId, overrides: {} };
}

export function isOverridden(row, field) {
  return Object.prototype.hasOwnProperty.call(row.overrides, field);
}

// The value a row will actually save for one field.
export function resolvedValue(shared, row, field) {
  return isOverridden(row, field) ? row.overrides[field] : shared[field];
}

export function resolveRow(shared, row) {
  const out = { teacherId: row.teacherId };
  BATCH_FIELDS.forEach((f) => {
    out[f] = resolvedValue(shared, row, f);
  });
  return out;
}

// Rows that cannot be saved yet. Date is the only hard requirement, matching
// the single-observation form.
export function rowsMissingDate(shared, rows) {
  return rows.filter((r) => !resolvedValue(shared, r, 'date'));
}

// Teacher ids whose resolved date already has a classroom observation. A hint
// only: two visits on one day can be real, so this never blocks a save.
export function duplicateTeacherIds(shared, rows, observations, isRealObservation) {
  const existing = new Set(
    observations.filter(isRealObservation).map((o) => `${o.teacherId}|${o.date}`)
  );
  const dupes = new Set();
  rows.forEach((r) => {
    const date = resolvedValue(shared, r, 'date');
    if (date && existing.has(`${r.teacherId}|${date}`)) dupes.add(r.teacherId);
  });
  return dupes;
}

// One insertable observation per row. `makeId` is crypto.randomUUID in the
// app; `makeItemId` gives each copied action item its own id so completing it
// on one teacher's record never touches another's.
export function buildBatchRecords(shared, rows, { createdBy, makeId, makeItemId }) {
  const items = (shared.actionItems || []).filter((ai) => (ai.description || '').trim());
  return rows.map((row) => ({
    id: makeId(),
    ...resolveRow(shared, row),
    actionItems: items.map((ai) => ({
      id: makeItemId(),
      description: ai.description.trim(),
      owner: ai.owner || '',
      dueDate: ai.dueDate || '',
      status: 'Open',
    })),
    attachments: [],
    createdBy,
    kind: 'observation',
    sharedWithTeacher: { whole: false, sections: [] },
  }));
}
