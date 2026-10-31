// courses.js — the courses a student can be registered for (the web console shows them as a dropdown).
const COURSES = [
  'National Diploma: Informatics',
  'National Diploma: Computer Science',
  'National Diploma: Information Technology',
  'National Diploma: Computer Systems Engineering',
  'National Diploma: Electrical Engineering',
  'Bachelor of Engineering Technology: Computer Engineering',
];

// A course from the list, null for "not set", or undefined when the value is not on the list.
// `keep` lets a student keep a course they already had before the list existed.
function checkCourse(value, keep = null) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const c = String(value).trim();
  return COURSES.includes(c) || c === keep ? c : undefined;
}

module.exports = { COURSES, checkCourse };
