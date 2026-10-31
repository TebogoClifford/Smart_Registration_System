import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

const ALL = 'all';
const STATUSES = [
  { value: ALL, label: 'Any status' }, { value: 'enrolled', label: 'Enrolled' },
  { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' },
];
const SORTS = [{ value: 'name', label: 'Name A–Z' }, { value: 'number', label: 'Student number' }];
const STATUS_TONE = { enrolled: 'default', pending: 'secondary', failed: 'destructive' };

// One filter dropdown; `items` = [{ value, label }], the first is the "everything" choice.
function Filter({ label, value, onChange, items }) {
  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange} items={items}>
        <SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

// Student directory with search and filters. They live in the address (?q=&course=…), so coming
// back from a student's page keeps them.
export default function StudentList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [modules, setModules] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const q = params.get('q') ?? '';
  const course = params.get('course') ?? ALL;
  const moduleId = params.get('module') ?? ALL;
  const status = params.get('status') ?? ALL;
  const deviceId = params.get('device') ?? ALL;
  const sort = params.get('sort') ?? 'name';
  const set = (key, value, fallback = ALL) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (!value || value === fallback) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });

  useEffect(() => {
    Promise.all([api.getStudents(), api.getCourses(), api.getModules(), api.getDevices()])
      .then(([s, c, m, d]) => { setStudents(s); setCourses(c); setModules(m); setDevices(d); })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const courseItems = useMemo(() => {
    const names = [...new Set([...courses, ...students.map((s) => s.course_name).filter(Boolean)])];
    return [{ value: ALL, label: 'Any course' }, { value: 'none', label: 'No course set' }, ...names.map((c) => ({ value: c, label: c }))];
  }, [courses, students]);
  const moduleItems = useMemo(() => [{ value: ALL, label: 'Any module' }, { value: 'none', label: 'No modules' },
    ...modules.map((m) => ({ value: String(m.id), label: `${m.code} — ${m.name}` }))], [modules]);
  const deviceItems = useMemo(() => [{ value: ALL, label: 'Any device' },
    ...devices.map((d) => ({ value: String(d.id), label: d.name }))], [devices]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = students.filter((s) => {
      const text = [s.name, s.student_number, s.course_name, ...(s.modules ?? []).flatMap((m) => [m.code, m.name])].join(' ').toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
      if (course === 'none' ? s.course_name : course !== ALL && s.course_name !== course) return false;
      if (moduleId === 'none' ? s.modules?.length : moduleId !== ALL && !s.modules?.some((m) => String(m.id) === moduleId)) return false;
      if (status !== ALL && s.enrollment_status !== status) return false;
      if (deviceId !== ALL && String(s.device_id) !== deviceId) return false;
      return true;
    });
    return rows.sort(sort === 'number'
      ? (a, b) => a.student_number.localeCompare(b.student_number, undefined, { numeric: true })
      : (a, b) => a.name.localeCompare(b.name));
  }, [students, q, course, moduleId, status, deviceId, sort]);

  const filtering = q || [course, moduleId, status, deviceId].some((v) => v !== ALL);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search" aria-label="Search students" value={q} onChange={(e) => set('q', e.target.value, '')}
              placeholder="Search by name, student number, course or module…" className="h-10 pl-9"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Filter label="Course" value={course} onChange={(v) => set('course', v)} items={courseItems} />
            <Filter label="Module" value={moduleId} onChange={(v) => set('module', v)} items={moduleItems} />
            <Filter label="Enrolment status" value={status} onChange={(v) => set('status', v)} items={STATUSES} />
            <Filter label="Device" value={deviceId} onChange={(v) => set('device', v)} items={deviceItems} />
            <Filter label="Sort by" value={sort} onChange={(v) => set('sort', v, 'name')} items={SORTS} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground" aria-live="polite">
              {loading ? 'Loading…' : `${shown.length} of ${students.length} student${students.length === 1 ? '' : 's'}`}
            </span>
            {filtering && <Button variant="ghost" size="sm" onClick={() => setParams(sort === 'name' ? {} : { sort }, { replace: true })}><X /> Clear filters</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">{students.length ? 'No students match your search or filters.' : 'No students yet. Add one on the Enrolment tab.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Modules</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.student_number}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.course_name || '—'}</TableCell>
                      <TableCell className="text-xs">{s.modules?.length ? s.modules.map((m) => m.code).join(', ') : '—'}</TableCell>
                      <TableCell><Badge variant={STATUS_TONE[s.enrollment_status] ?? 'secondary'}>{s.enrollment_status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/students/${s.id}`)}>Manage</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
