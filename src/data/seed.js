// ---------------------------------------------------------------------------
// Demo seed data for PacingIQ.
//
// Dates are computed relative to "today" so the dashboard always looks live in
// a demo. The mix of teachers is deliberate: red / yellow / green pacing,
// overdue actions, an open intervention, assessment concerns, and a teacher
// who has not been seen inside the 14 day window.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function iso(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setTime(d.getTime() + daysFromToday * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

// Monday-of-week helper for pacing weekOf values.
function weekOf(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setTime(d.getTime() + daysFromToday * MS_PER_DAY);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setTime(d.getTime() + diff * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

const teachers = [
  { id: 't_rivera', name: 'Maria Rivera', subject: 'Algebra I', gradeLevel: '9', assignedAdmin: 'Principal Adams' },
  { id: 't_chen', name: 'David Chen', subject: 'Biology', gradeLevel: '10', assignedAdmin: 'AP Brooks' },
  { id: 't_okafor', name: 'Grace Okafor', subject: 'English II', gradeLevel: '10', assignedAdmin: 'Principal Adams' },
  { id: 't_torres', name: 'Luis Torres', subject: 'World History', gradeLevel: '9', assignedAdmin: 'AP Brooks' },
  { id: 't_nguyen', name: 'Anh Nguyen', subject: 'Geometry', gradeLevel: '10', assignedAdmin: 'Principal Adams' },
  { id: 't_baker', name: 'Sarah Baker', subject: 'Chemistry', gradeLevel: '11', assignedAdmin: 'AP Brooks' },
  { id: 't_johnson', name: 'Marcus Johnson', subject: 'English I', gradeLevel: '9', assignedAdmin: 'Principal Adams' },
  { id: 't_patel', name: 'Priya Patel', subject: 'Physics', gradeLevel: '11', assignedAdmin: 'AP Brooks' },
];

const pacingEntries = [
  // Rivera: red, 5 days behind
  { id: 'p_rivera', teacherId: 't_rivera', weekOf: weekOf(0), currentUnit: 'Unit 4: Linear Functions', currentLesson: 'Lesson 4.2', currentStandard: 'A-REI.10', daysBehind: 5, exceptionReason: '', notes: 'Class needed extra time on slope intercept form.' },
  // Chen: yellow, 2 days behind, with a logged exception
  { id: 'p_chen', teacherId: 't_chen', weekOf: weekOf(0), currentUnit: 'Unit 3: Cell Energy', currentLesson: 'Lesson 3.4', currentStandard: 'HS-LS1-7', daysBehind: 2, exceptionReason: 'Assembly', notes: 'Lost a period to the fall assembly.' },
  // Okafor: green, on pace
  { id: 'p_okafor', teacherId: 't_okafor', weekOf: weekOf(0), currentUnit: 'Unit 2: Argument & Evidence', currentLesson: 'Lesson 2.5', currentStandard: 'RI.10.8', daysBehind: 0, exceptionReason: '', notes: 'On track.' },
  // Torres: red, 6 days behind
  { id: 'p_torres', teacherId: 't_torres', weekOf: weekOf(0), currentUnit: 'Unit 3: Early Empires', currentLesson: 'Lesson 3.1', currentStandard: 'WH.3.2', daysBehind: 6, exceptionReason: 'Student remediation', notes: 'Significant reteach needed after unit 2 test.' },
  // Nguyen: green
  { id: 'p_nguyen', teacherId: 't_nguyen', weekOf: weekOf(0), currentUnit: 'Unit 4: Congruence', currentLesson: 'Lesson 4.3', currentStandard: 'G-CO.7', daysBehind: 0, exceptionReason: '', notes: '' },
  // Baker: yellow, 3 days behind
  { id: 'p_baker', teacherId: 't_baker', weekOf: weekOf(0), currentUnit: 'Unit 5: Stoichiometry', currentLesson: 'Lesson 5.1', currentStandard: 'HS-PS1-7', daysBehind: 3, exceptionReason: 'Field trip', notes: '' },
  // Johnson: green
  { id: 'p_johnson', teacherId: 't_johnson', weekOf: weekOf(0), currentUnit: 'Unit 2: Narrative Craft', currentLesson: 'Lesson 2.6', currentStandard: 'W.9.3', daysBehind: 0, exceptionReason: '', notes: '' },
  // Patel: green but not observed recently (handled via observations)
  { id: 'p_patel', teacherId: 't_patel', weekOf: weekOf(0), currentUnit: 'Unit 4: Forces', currentLesson: 'Lesson 4.4', currentStandard: 'HS-PS2-1', daysBehind: 1, exceptionReason: '', notes: '' },
];

const observations = [
  {
    id: 'o_rivera_1', teacherId: 't_rivera', date: iso(-9), time: '10:15',
    lessonObserved: 'Solving multi-step equations', standard: 'A-REI.3',
    evidence: 'Students worked in pairs on a problem set; teacher circulated.',
    engagementLevel: 'Medium', evidenceOfLearning: 'Exit ticket showed ~60% mastery.',
    teacherActions: 'Modeled two examples, then released to practice.',
    studentActions: 'Some students off task during independent work.',
    strengths: 'Clear modeling and strong rapport with students.',
    areasForGrowth: 'Tighten the independent practice routine and pacing.',
    feedbackProvided: 'Discussed a timed practice structure to keep momentum.',
    followUpObservationDate: iso(5),
    actionItems: [
      { id: 'a_riv1', description: 'Implement a 10 minute timed practice block', owner: 'Maria Rivera', dueDate: iso(-2), status: 'Open' },
      { id: 'a_riv2', description: 'Share exit-ticket data with coach', owner: 'Maria Rivera', dueDate: iso(4), status: 'Open' },
    ],
    createdBy: 'coach',
    sharedWithTeacher: { whole: false, sections: [] },
  },
  {
    id: 'o_okafor_1', teacherId: 't_okafor', date: iso(-4), time: '09:00',
    lessonObserved: 'Analyzing counterarguments', standard: 'RI.10.8',
    evidence: 'Socratic seminar with text annotations.',
    engagementLevel: 'High', evidenceOfLearning: 'Strong student discourse, most cited evidence.',
    teacherActions: 'Facilitated with probing questions.',
    studentActions: 'Led discussion, referenced text directly.',
    strengths: 'Excellent questioning and student ownership.',
    areasForGrowth: 'Pull in the two quietest students earlier.',
    feedbackProvided: 'Praised discourse; suggested a turn-and-talk warmup.',
    followUpObservationDate: iso(14),
    actionItems: [
      { id: 'a_oka1', description: 'Add a turn-and-talk warmup to next seminar', owner: 'Grace Okafor', dueDate: iso(7), status: 'Complete' },
    ],
    createdBy: 'coach',
    sharedWithTeacher: { whole: true, sections: [] },
  },
  {
    id: 'o_torres_1', teacherId: 't_torres', date: iso(-16), time: '13:30',
    lessonObserved: 'River valley civilizations', standard: 'WH.2.4',
    evidence: 'Lecture with guided notes.',
    engagementLevel: 'Low', evidenceOfLearning: 'Limited checks for understanding.',
    teacherActions: 'Primarily direct instruction for the full period.',
    studentActions: 'Passive note taking, low participation.',
    strengths: 'Strong content knowledge.',
    areasForGrowth: 'Add active processing and formative checks.',
    feedbackProvided: 'Introduced a 3-2-1 formative routine.',
    followUpObservationDate: iso(-2),
    actionItems: [
      { id: 'a_tor1', description: 'Use a formative check every 15 minutes', owner: 'Luis Torres', dueDate: iso(-5), status: 'Open' },
    ],
    createdBy: 'coach',
    sharedWithTeacher: { whole: false, sections: [] },
  },
  {
    id: 'o_nguyen_1', teacherId: 't_nguyen', date: iso(-6), time: '11:00',
    lessonObserved: 'Triangle congruence proofs', standard: 'G-CO.7',
    evidence: 'Whiteboard proof relay.',
    engagementLevel: 'High', evidenceOfLearning: 'Most groups completed proofs correctly.',
    teacherActions: 'Used a structured proof template.',
    studentActions: 'Collaborated on whiteboards.',
    strengths: 'Great use of collaborative structures.',
    areasForGrowth: 'Stretch the early finishers.',
    feedbackProvided: 'Suggested extension proofs for fast groups.',
    followUpObservationDate: iso(16),
    actionItems: [],
    createdBy: 'coach',
    sharedWithTeacher: { whole: false, sections: [] },
  },
  // Patel: last observation outside the 14 day window
  {
    id: 'o_patel_1', teacherId: 't_patel', date: iso(-19), time: '14:00',
    lessonObserved: 'Newton second law lab', standard: 'HS-PS2-1',
    evidence: 'Lab stations with data collection.',
    engagementLevel: 'Medium', evidenceOfLearning: 'Lab sheets mostly complete.',
    teacherActions: 'Ran a hands-on lab with rotation.',
    studentActions: 'Collected and graphed data.',
    strengths: 'Strong hands-on design.',
    areasForGrowth: 'Tighten lab cleanup transitions.',
    feedbackProvided: 'Discussed transition timing.',
    followUpObservationDate: iso(-1),
    actionItems: [],
    createdBy: 'coach',
    sharedWithTeacher: { whole: false, sections: [] },
  },
];

const assessments = [
  // Rivera: downward trend + low proficiency
  { id: 'as_riv_1', teacherId: 't_rivera', name: 'Unit 3 Test: Equations', date: iso(-30), avgScore: 78, proficiencyPct: 72 },
  { id: 'as_riv_2', teacherId: 't_rivera', name: 'Unit 4 Test: Linear Functions', date: iso(-3), avgScore: 69, proficiencyPct: 61 },
  // Chen
  { id: 'as_chen_1', teacherId: 't_chen', name: 'Unit 2 Test: Cell Structure', date: iso(-25), avgScore: 84, proficiencyPct: 81 },
  { id: 'as_chen_2', teacherId: 't_chen', name: 'Unit 3 Test: Cell Energy', date: iso(-2), avgScore: 86, proficiencyPct: 83 },
  // Okafor: strong
  { id: 'as_oka_1', teacherId: 't_okafor', name: 'Unit 2 Test: Argument', date: iso(-1), avgScore: 90, proficiencyPct: 88 },
  // Torres: low proficiency
  { id: 'as_tor_1', teacherId: 't_torres', name: 'Unit 2 Test: Early Empires', date: iso(-5), avgScore: 66, proficiencyPct: 58 },
  // Nguyen
  { id: 'as_ngu_1', teacherId: 't_nguyen', name: 'Unit 3 Test: Transformations', date: iso(-8), avgScore: 88, proficiencyPct: 85 },
  // Baker
  { id: 'as_bak_1', teacherId: 't_baker', name: 'Unit 4 Test: Reactions', date: iso(-6), avgScore: 80, proficiencyPct: 76 },
];

// Upcoming unit tests are modeled as assessments with a future date and no scores.
const upcomingAssessments = [
  { id: 'as_up_riv', teacherId: 't_rivera', name: 'Unit 5 Test: Systems', date: iso(6), avgScore: null, proficiencyPct: null },
  { id: 'as_up_chen', teacherId: 't_chen', name: 'Unit 4 Test: Photosynthesis', date: iso(3), avgScore: null, proficiencyPct: null },
  { id: 'as_up_ngu', teacherId: 't_nguyen', name: 'Unit 4 Test: Congruence', date: iso(9), avgScore: null, proficiencyPct: null },
  { id: 'as_up_bak', teacherId: 't_baker', name: 'Unit 5 Test: Stoichiometry', date: iso(12), avgScore: null, proficiencyPct: null },
  { id: 'as_up_tor', teacherId: 't_torres', name: 'Unit 3 Test: Empires', date: iso(2), avgScore: null, proficiencyPct: null },
];

const interventions = [
  // Torres: active intervention (Red status workflow already triggered)
  {
    id: 'iv_torres', teacherId: 't_torres', status: 'In Progress', openedDate: iso(-7),
    concern: 'Sustained pacing slippage (6 days behind) with low Unit 2 proficiency (58%).',
    rootCause: 'Reteach load after weak unit-test results; limited formative checks during instruction.',
    responsiblePerson: 'Coach',
    dueDate: iso(8),
    followUpDate: iso(4),
    evidenceOfCompletion: '',
    requirements: {
      caseCreated: true,
      actionPlan: true,
      coachingMeetingScheduled: true,
      followUpObservation: false,
      leadershipReview: false,
    },
    agreedActions: [
      { id: 'iva_tor1', description: 'Co-plan a compressed Unit 3 pacing map', owner: 'Coach', dueDate: iso(-1), status: 'Complete' },
      { id: 'iva_tor2', description: 'Embed a formative check every 15 minutes', owner: 'Luis Torres', dueDate: iso(3), status: 'In Progress' },
      { id: 'iva_tor3', description: 'Follow-up observation focused on engagement', owner: 'Coach', dueDate: iso(4), status: 'Open' },
    ],
  },
];

export const SEED = {
  teachers,
  observations,
  pacingEntries,
  assessments: [...assessments, ...upcomingAssessments],
  interventions,
  auditLog: [],
};
