import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import { api } from '@/lib/api';
import { ArrowLeft, Eye, Copy } from 'lucide-react';

export default function DeviceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [venues, setVenues] = useState([]);
  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [students, setStudents] = useState([]);
  const [showKey, setShowKey] = useState(false);

  const load = async () => {
    try {
      const d = await api.getDevice(id);
      setDevice(d);
      setName(d.name);
      setVenueId(String(d.venue_id));

      const vList = await api.getVenues();
      setVenues(vList);

      const sList = await api.getStudents();
      setStudents(sList.filter((s) => String(s.device_id) === id));
    } catch (err) {
      toast.error('Failed to load device details');
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    try {
      await api.updateDevice(id, Number(venueId), name);
      toast.success('Device updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteDevice(id);
      toast.success('Device deleted');
      navigate('/devices');
    } catch (err) {
      toast.error(err.message); // Handles "Block-on-delete" (e.g. students enrolled)
    }
  };

  if (!device) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/devices')} className="gap-2">
        <ArrowLeft size={16} /> Back to Devices
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Edit Device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Device Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Assigned Venue</label>
            <Select value={venueId} onValueChange={setVenueId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">API Key:</span>
            <code className="text-sm font-mono flex-1">{showKey ? device.api_key : '••••••••••••••••••••' }</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowKey(!showKey)}
              className="gap-2"
            >
              {showKey ? 'Hide' : <><Eye size={14} /> Reveal</>}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(device.api_key);
                toast.success('API Key copied to clipboard');
              }}
              className="gap-2"
            >
              <Copy size={14} /> Copy
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave}>Save Changes</Button>
            <ConfirmDeleteDialog itemName="this device" onConfirm={handleDelete} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enrolled Students ({students.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No students enrolled on this device.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.student_number}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant={s.enrollment_status === 'enrolled' ? 'default' : 'secondary'}>
                        {s.enrollment_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/students/${s.id}`)}
                      >
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
