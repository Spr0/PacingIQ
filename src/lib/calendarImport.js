// ---------------------------------------------------------------------------
// Turning a reviewed pacing-calendar draft into database writes.
//
// Extracted from PacingCalendarReader so it can be tested directly: this is
// where a multi-teacher import goes wrong quietly. Everything that decides
// insert-vs-update, or duplicate-or-not, is keyed by teacher -- an assessment
// that already exists for one member of a grade-level team says nothing about
// the others, and getting that wrong either drops rows for everyone but the
// first teacher or writes the same unit test to one teacher N times.
//
// Pure: no database access, no React. Returns the writes to make.
// ---------------------------------------------------------------------------

// A draft row only becomes a pacing entry if it has a week AND something to say
// about that week. Rows with a date but no content are review leftovers.
function hasPacingContent(w) {
  return !!w.weekOf && !!(w.unit || w.lesson || w.standard);
}

export function planCalendarImport({ weeks, teachers, subject, pacingEntries = [], assessments = [] }) {
  const toInsert = [];
  const toUpdate = [];
  const newAssessments = [];
  const subjectValue = subject || '';

  teachers.forEach((teacher) => {
    const teacherId = teacher.id;

    weeks.forEach((w) => {
      if (hasPacingContent(w)) {
        const existing = pacingEntries.find(
          (p) => p.teacherId === teacherId && p.weekOf === w.weekOf && (p.subject || '') === subjectValue
        );
        const patch = {
          teacherId,
          subject: subjectValue,
          currentUnit: w.unit || '',
          currentLesson: w.lesson || '',
          currentStandard: w.standard || '',
        };
        if (existing) toUpdate.push({ id: existing.id, patch });
        else
          toInsert.push({
            ...patch,
            weekOf: w.weekOf,
            daysBehind: 0,
            exceptionReason: '',
            notes: 'Imported from pacing calendar.',
          });
      }

      if (w.assessmentName && w.assessmentDate) {
        const dup =
          assessments.some(
            (a) => a.teacherId === teacherId && a.name === w.assessmentName && a.date === w.assessmentDate
          ) ||
          // Guard within this batch too: a year-long calendar repeats
          // "End-of-Unit Assessment", and rows that only exist in this batch
          // cannot be caught by the check above. Keyed by teacher as well as
          // name and date -- the same unit test for two teachers on a team is
          // two records, not a duplicate.
          newAssessments.some(
            (a) => a.teacherId === teacherId && a.name === w.assessmentName && a.date === w.assessmentDate
          );
        if (!dup) {
          newAssessments.push({
            teacherId,
            name: w.assessmentName,
            date: w.assessmentDate,
            avgScore: null,
            proficiencyPct: null,
          });
        }
      }
    });
  });

  return { toInsert, toUpdate, newAssessments };
}
