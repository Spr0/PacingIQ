// ---------------------------------------------------------------------------
// Role + permission model.
//
// The signed-in user's role comes from the `profiles` table (see
// supabase/schema.sql), set by a coach/admin editing that table directly --
// there's no in-app way to grant yourself a role. `pending` (the default for
// a brand new sign-in) is handled upstream in App.jsx, which shows a
// "waiting on access" screen instead of ever rendering a page for it; can()
// still treats it as no-access here too, so nothing relies solely on that
// outer gate.
// ---------------------------------------------------------------------------

export const ROLE_LABELS = {
  coach: 'Instructional Coach',
  principal: 'Principal',
  ap: 'Assistant Principal',
  pending: 'Pending Approval',
};

export const ROLE_ORDER = ['coach', 'principal', 'ap'];

const REAL_ROLES = ['coach', 'principal', 'ap'];

// First letters of up to the first two words of a name, e.g. "Stacy
// Eilander" -> "SE". Falls back to "?" for an empty/missing name.
export function initialsOf(name) {
  const initials = (name || '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || '?';
}

// Capability checks. Keep these centralized so the UI and the RLS policies
// in supabase/schema.sql agree on who can do what.
//
//   write            create / edit records and coaching notes  -> coach only
//   leadershipReview record a leadership review on interventions -> principal / AP
//   view             read everything                            -> coach / principal / AP
export function can(roleKey, action) {
  switch (action) {
    case 'view':
    case 'runReports':
      return REAL_ROLES.includes(roleKey);
    case 'write':
      return roleKey === 'coach';
    case 'leadershipReview':
      return roleKey === 'principal' || roleKey === 'ap';
    default:
      return false;
  }
}

// Coaching notes are owned by their creator. Principals and APs may read but not
// edit another user's notes (per the spec).
export function canEditNote(roleKey, record) {
  if (roleKey !== 'coach') return false;
  return !record || record.createdBy === 'coach' || record.createdBy == null;
}
