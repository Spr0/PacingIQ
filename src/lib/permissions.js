// ---------------------------------------------------------------------------
// Role + permission model.
//
// The signed-in user's role comes from the `profiles` table (see
// supabase/schema.sql), set by editing that table directly in the Supabase
// dashboard -- there's no in-app way to grant yourself a role. `pending`
// (the default for a brand new sign-in) is handled upstream in App.jsx,
// which shows a "waiting on access" screen instead of ever rendering a page
// for it; can() still treats it as no-access here too, so nothing relies
// solely on that outer gate.
//
// Every check here is mirrored by an RLS policy in supabase/schema.sql. The
// UI layer is a convenience, not the security boundary -- Postgres is.
// ---------------------------------------------------------------------------

export const ROLE_LABELS = {
  coach: 'Instructional Coach',
  principal: 'Principal',
  ap: 'Assistant Principal',
  abss: 'ABSS',
  pending: 'Pending Approval',
};

export const ROLE_ORDER = ['coach', 'principal', 'ap', 'abss'];

const REAL_ROLES = ['coach', 'principal', 'ap', 'abss'];

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
//   view             read everything                  -> every real role
//   write            create observations, coaching
//                    notes, action steps, pacing      -> every real role
//   delete           remove records entirely          -> coach only
//   leadershipReview record a leadership review       -> principal / AP
export function can(roleKey, action) {
  switch (action) {
    case 'view':
    case 'runReports':
      return REAL_ROLES.includes(roleKey);
    // Principals, APs, and ABSS log their own walkthroughs and add notes and
    // action steps, so creating is open to every real role. Destroying is
    // not: delete stays coach-only so an accidental click can't erase
    // another person's record.
    case 'write':
      return REAL_ROLES.includes(roleKey);
    case 'delete':
      return roleKey === 'coach';
    case 'leadershipReview':
      return roleKey === 'principal' || roleKey === 'ap';
    default:
      return false;
  }
}

// Records are owned by whoever created them: you may edit your own, and a
// coach may edit anyone's. `userId` is the signed-in user's auth id and
// `record.createdById` is who created it.
//
// Legacy records created before per-user auth existed have no createdById
// (they were all stamped with the literal string 'coach'), so they're
// treated as coach-owned rather than editable by everyone.
export function canEditRecord(roleKey, userId, record) {
  if (!can(roleKey, 'write')) return false;
  if (roleKey === 'coach') return true;
  if (!record) return true; // creating something new
  if (!record.createdById) return false; // legacy / coach-owned
  return record.createdById === userId;
}

// Deleting is coach-only regardless of who created the record.
export function canDeleteRecord(roleKey) {
  return can(roleKey, 'delete');
}
