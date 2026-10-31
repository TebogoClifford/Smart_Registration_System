import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ArrowLeft } from 'lucide-react';

export default function VenueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth(); // invigilators may look, only administrators may change
  const [venue, setVenue] = useState(null);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [devices, setDevices] = useState([]);

  const load = useCallback(async () => {
    try {
      const venues = await api.getVenues();
      const found = venues.find((v) => String(v.id) === id);
      if (!found) {
        toast.error('Venue not found');
        navigate('/venues');
        return;
      }
      setVenue(found);
      setName(found.name);
      setCapacity(String(found.capacity ?? ''));

      const allDevices = await api.getDevices();
      setDevices(allDevices.filter((d) => String(d.venue_id) === id));
    } catch {
      toast.error('Failed to load venue details');
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const [saving, setSaving] = useState(false);
  const handleSave = async (e) => {
    e.preventDefault();
    const seats = Number(capacity);
    if (!name.trim()) { toast.error('Enter the venue name'); return; }
    if (!Number.isInteger(seats) || seats < 1) { toast.error('Enter the capacity: a whole number of seats, 1 or more'); return; }
    setSaving(true);
    try {
      await api.updateVenue(id, name.trim(), seats);
      toast.success(`${name.trim()} saved · ${seats} seats`);
      navigate('/venues');
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteVenue(id);
      toast.success('Venue deleted');
      navigate('/venues');
    } catch (err) {
      toast.error(err.message); // This handles the "Block-on-delete" error from backend
    }
  };

  if (!venue) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/venues')} className="gap-2">
        <ArrowLeft size={16} /> Back to Venues
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Venue Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor="venue-name" className="text-sm font-medium">Venue name</label>
              <Input id="venue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Exam Hall A" disabled={!isAdmin} />
            </div>
            <div className="space-y-1.5 sm:w-40">
              <label htmlFor="venue-capacity" className="text-sm font-medium">Capacity (seats)</label>
              <Input
                id="venue-capacity" type="number" min="1" step="1" inputMode="numeric" disabled={!isAdmin}
                value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 120"
              />
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
                <ConfirmDeleteDialog itemName="this venue" onConfirm={handleDelete} />
              </div>
            )}
          </form>
          {isAdmin && <p className="mt-2 text-xs text-muted-foreground">Capacity is the number of exam seats in this venue. Bookings can't seat more students than this.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned Devices ({devices.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No devices assigned to this venue.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded-full ${d.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {d.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/devices/${d.id}`)}
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
