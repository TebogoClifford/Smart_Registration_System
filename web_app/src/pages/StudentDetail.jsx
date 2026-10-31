import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import CourseSelect from '@/components/CourseSelect';
import StudentEnrolment from '@/components/StudentEnrolment';
import { api } from '@/lib/api';
import { ArrowLeft } from 'lucide-react';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [devices, setDevices] = useState([]);
  const [studentNumber, setStudentNumber] = useState('');
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [courseName, setCourseName] = useState('');
  const [allModules, setAllModules] = useState([]);
  const [moduleIds, setModuleIds] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const s = await api.getStudent(id);
      setStudent(s);
      setStudentNumber(s.student_number);
      setName(s.name);
      setDeviceId(String(s.device_id));
      setCourseName(s.course_name ?? '');
      setModuleIds(new Set((s.modules ?? []).map((m) => m.id)));

      const [dList, mList] = await Promise.all([api.getDevices(), api.getModules()]);
      setDevices(dList);
      setAllModules(mList);
    } catch {
      toast.error('Failed to load student details');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      await api.updateStudent(id, studentNumber, name, Number(deviceId), courseName);
      await api.setStudentModules(id, [...moduleIds]);
      toast.success('Student updated');
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
      {/* back to the list as it was (search and filters kept) when we came from it */}
      <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/students'))} className="gap-2">
        <ArrowLeft size={16} /> Back to Students
      </Button>

      <StudentEnrolment student={student} device={devices.find((d) => d.id === student.device_id)} onStudentChange={setStudent} />

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
          <div className="flex gap-2">
            <Button onClick={handleSave}>Save Changes</Button>
            <ConfirmDeleteDialog itemName="this student" onConfirm={handleDelete} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
