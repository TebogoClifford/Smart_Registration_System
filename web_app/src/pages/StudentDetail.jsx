import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
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

  const load = async () => {
    try {
      const s = await api.getStudent(id);
      setStudent(s);
      setStudentNumber(s.student_number);
      setName(s.name);
      setDeviceId(String(s.device_id));

      const dList = await api.getDevices();
      setDevices(dList);
    } catch (err) {
      toast.error('Failed to load student details');
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    try {
      await api.updateStudent(id, studentNumber, name, Number(deviceId));
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
      <Button variant="ghost" size="sm" onClick={() => navigate('/students')} className="gap-2">
        <ArrowLeft size={16} /> Back to Students
      </Button>

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
            <label className="text-sm font-medium">Assigned Device</label>
            <Select value={deviceId} onValueChange={setDeviceId}>
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
