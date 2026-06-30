// ---------------------------------------------------------------------------
// Mock role + permission model.
//
// In the demo there is no real authentication. A role switcher selects the
// current user. When this is re-platformed onto MS Copilot / Workspace SSO the
// `currentRole` comes from the identity provider instead, but the permission
// checks below stay the same.
// ---------------------------------------------------------------------------

export const ROLES = {
  coach: { key: 'coach', label: 'Instructional Coach', name: 'Jordan Lee', initials: 'JL' },
  principal: { key: 'principal', label: 'Principal', name: 'Principal Adams', initials: 'PA' },
  ap: { key: 'ap', label: 'Assistant Principal', name: 'AP Brooks', initials: 'AB' },
};

export const ROLE_ORDER = ['coach', 'principal', 'ap'];

// Capability checks. Keep these centralized so the UI and any future backend
// agree on who can do what.
//
//   write            create / edit records and coaching notes  -> coach only
//   leadershipReview record a leadership review on interventions -> principal / AP
//   view             read everything                            -> all roles
//   reset            reset the demo data                        -> all (demo only)
export function can(roleKey, action) {
  switch (action) {
    case 'view':
    case 'runReports':
    case 'reset':
      return true;
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
  // In the demo every note is authored by the coach role.
  return !record || record.createdBy === 'coach' || record.createdBy == null;
}
