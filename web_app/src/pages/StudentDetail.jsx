import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import CourseSelect from '@/components/CourseSelect';
import StudentEnrolment, { EnrolFaceButton } from '@/components/StudentEnrolment';
import DraftNotice from '@/components/DraftNotice';
import { api } from '@/lib/api';
import { useDraft, hasDraft, clearDrafts, lastPage } from '@/lib/drafts';
import { ArrowLeft } from 'lucide-react';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [devices, setDevices] = useState([]);
  // the form keeps unsaved edits when you go to another tab and come back (lib/drafts.js)
  const k = `student:${id}:`;
  const [studentNumber, setStudentNumber, numberDraft] = useDraft(`${k}number`, '');
  const [name, setName, nameDraft] = useDraft(`${k}name`, '');
  const [deviceId, setDeviceId, deviceDraft] = useDraft(`${k}device`, '');
  const [courseName, setCourseName, courseDraft] = useDraft(`${k}course`, '');
  const [allModules, setAllModules] = useState([]);
  const [moduleIds, setModuleIds, modulesDraft] = useDraft(`${k}modules`, () => new Set());
  const drafts = [numberDraft, nameDraft, deviceDraft, courseDraft, modulesDraft];
  const restored = drafts.some((d) => d.restored);

  const load = useCallback(async () => {
    try {
      const s = await api.getStudent(id);
      setStudent(s);
      // fields you have not changed show what is stored; changed ones keep your draft
      const fill = (field, draft, value) => { if (!hasDraft(`${k}${field}`)) draft.reset(value); };
      fill('number', numberDraft, s.student_number);
      fill('name', nameDraft, s.name);
      fill('device', deviceDraft, String(s.device_id));
      fill('course', courseDraft, s.course_name ?? '');
      fill('modules', modulesDraft, new Set((s.modules ?? []).map((m) => m.id)));

      const [dList, mList] = await Promise.all([api.getDevices(), api.getModules()]);
      setDevices(dList);
      setAllModules(mList);
    } catch {
      toast.error('Failed to load student details');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the draft helpers are stable; reload only for another student
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const discard = () => { clearDrafts(k); load(); };

  const handleSave = async () => {
    try {
      await api.updateStudent(id, studentNumber, name, Number(deviceId), courseName);
      await api.setStudentModules(id, [...moduleIds]);
      toast.success('Student updated');
      clearDrafts(k);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteStudent(id);
      toast.success('Student deleted');
      navigate('/students');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!student) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* back to the list as you last left it (search and filters kept) */}
      <Button variant="ghost" size="sm" onClick={() => { clearDrafts(k); navigate(lastPage('list:/students') ?? '/students'); }} className="gap-2">
        <ArrowLeft size={16} /> Back to Students
      </Button>

      <DraftNotice show={restored} onDiscard={discard} />

      <StudentEnrolment student={student} device={devices.find((d) => d.id === student.device_id)} />

      <Card>
        <CardHeader>
          <CardTitle>Edit Student</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Student Number</label>
            <Input value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Full Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="student-course" className="text-sm font-medium">Course</label>
            <CourseSelect id="student-course" value={courseName} onChange={setCourseName} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Registered modules</label>
            {allModules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No modules exist yet. Add them under Modules.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {allModules.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                    <input type="checkbox" checked={moduleIds.has(m.id)}
                      onChange={() => setModuleIds((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
                    <span className="font-mono text-xs">{m.code}</span> <span>{m.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">If a module is already booked for an exam, ticking it reserves a seat automatically.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Assigned Device</label>
            <Select value={deviceId} onValueChange={setDeviceId} items={devices.map((d) => ({ value: String(d.id), label: d.name }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {devices.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave}>Save Changes</Button>
            <EnrolFaceButton student={student} device={devices.find((d) => d.id === student.device_id)} onStudentChange={setStudent} />
            <ConfirmDeleteDialog itemName="this student" onConfirm={handleDelete} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
