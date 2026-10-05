import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { Plus } from 'lucide-react';

export default function DeviceList() {
  const [devices, setDevices] = useState([]);
  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadDevices = async () => {
    try {
      const data = await api.getDevices();
      setDevices(data);
    } catch (err) {
      toast.error('Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    Promise.all([loadDevices(), api.getVenues().then(setVenues)]);
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || !venueId) {
      toast.error('Please provide both device name and venue');
      return;
    }
    try {
      await api.createDevice(Number(venueId), name);
      toast.success('Device created');
      setName('');
      setVenueId('');
      loadDevices();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Devices</h2>
          <p className="text-muted-foreground">Manage ESP32-CAM access devices.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Device</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
            <Input
              placeholder="Device Name (e.g. Entrance Cam 1)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
            >
              <option value="">Select Venue</option>
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <Button type="submit">
              <Plus size={16} className="mr-2" /> Add Device
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id} className="group">
                    <TableCell className="font-mono text-xs">{d.id}</TableCell>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {venues.find(v => v.id === d.venue_id)?.name || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'active' ? 'default' : 'secondary'}>
                        {d.status}
                      </Badge>
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
