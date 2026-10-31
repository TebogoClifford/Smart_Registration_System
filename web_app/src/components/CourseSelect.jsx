import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

const NONE = '__none__';
let cached = null; // the list never changes while the page is open

// Dropdown of the courses the server accepts. `value` is the course name, '' for none.
// A course saved before the list existed is still shown, so editing a student never loses it.
export default function CourseSelect({ id, value, onChange }) {
  const [courses, setCourses] = useState(cached ?? []);
  useEffect(() => {
    if (cached) return;
    api.getCourses().then((list) => { cached = list; setCourses(list); }).catch(() => {});
  }, []);

  const items = useMemo(() => {
    const list = value && !courses.includes(value) ? [...courses, value] : courses;
    return [{ value: NONE, label: 'Not set' }, ...list.map((c) => ({ value: c, label: c }))];
  }, [courses, value]);

  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} items={items}>
      <SelectTrigger id={id} aria-label="Course" className="w-full"><SelectValue placeholder="Choose a course" /></SelectTrigger>
      <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
