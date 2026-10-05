import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import { api } from '@/lib/api';
import { ArrowLeft } from 'lucide-react';

export default function VenueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [venue, setVenue] = useState(null);
  const [name, setName] = useState('');
  const [devices, setDevices] = useState([]);

  const load = async () => {
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

      const allDevices = await api.getDevices();
      setDevices(allDevices.filter((d) => String(d.venue_id) === id));
    } catch (err) {
      toast.error('Failed to load venue details');
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    try {
      await api.updateVenue(id, name);
      toast.success('Venue updated successfully');
      load();
    } catch (err) {
      toast.error(err.message);
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
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Venue Name"
            />
            <Button onClick={handleSave}>Save Changes</Button>
            <ConfirmDeleteDialog itemName="this venue" onConfirm={handleDelete} />
          </div>
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
