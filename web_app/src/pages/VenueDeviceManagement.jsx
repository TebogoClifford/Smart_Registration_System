import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { Plus, MapPin, Cpu, Search, RefreshCw } from 'lucide-react';

export default function VenueDeviceManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get('tab') === 'devices' ? 'devices' : 'venues';
  const [venues, setVenues] = useState([]);
  const [devices, setDevices] = useState([]);
  const [venueName, setVenueName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [venueData, deviceData] = await Promise.all([api.getVenues(), api.getDevices()]);
      setVenues(Array.isArray(venueData) ? venueData : []);
      setDevices(Array.isArray(deviceData) ? deviceData : []);
    } catch (error) {
      toast.error('Failed to load venues and devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddVenue = async (event) => {
    event.preventDefault();
    if (!venueName.trim()) return;
    setSaving(true);
    try {
      await api.createVenue(venueName.trim());
      toast.success('Venue created');
      setVenueName('');
      await loadData();
    } catch (error) {
      toast.error(error.message || 'Could not create venue');
    } finally {
      setSaving(false);
    }
  };

  const handleAddDevice = async (event) => {
    event.preventDefault();
    if (!deviceName.trim() || !venueId) {
      toast.error('Enter a device name and select a venue');
      return;
    }
    setSaving(true);
    try {
      await api.createDevice(Number(venueId), deviceName.trim());
      toast.success('Device created');
      setDeviceName('');
      setVenueId('');
      await loadData();
    } catch (error) {
      toast.error(error.message || 'Could not create device');
    } finally {
      setSaving(false);
    }
  };

  const filteredVenues = venues.filter((venue) =>
    [venue.name, venue.id].some((value) => String(value ?? '').toLowerCase().includes(search.toLowerCase()))
  );
  const filteredDevices = devices.filter((device) =>
    [device.name, device.id, device.status, venues.find((venue) => String(venue.id) === String(device.venue_id))?.name]
      .some((value) => String(value ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  const switchTab = (tab) => {
    setSearch('');
    setSearchParams(tab === 'venues' ? {} : { tab });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">System configuration</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Venues &amp; Devices</h1>
          <p className="mt-2 text-sm text-muted-foreground">Manage exam locations and the access devices installed at each venue.</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading} className="gap-2 self-start rounded-xl sm:self-auto">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh data
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><MapPin size={22} /></div>
            <div><p className="text-sm text-muted-foreground">Total venues</p><p className="text-2xl font-bold">{venues.length}</p></div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><Cpu size={22} /></div>
            <div><p className="text-sm text-muted-foreground">Total devices</p><p className="text-2xl font-bold">{devices.length}</p></div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Cpu size={22} /></div>
            <div><p className="text-sm text-muted-foreground">Active devices</p><p className="text-2xl font-bold">{devices.filter((device) => String(device.status).toLowerCase() === 'active').length}</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Venue and device management">
          <button type="button" role="tab" aria-selected={activeTab === 'venues'} onClick={() => switchTab('venues')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'venues' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <MapPin size={16} /> Venues <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{venues.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'devices'} onClick={() => switchTab('devices')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'devices' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Cpu size={16} /> Devices <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{devices.length}</span>
          </button>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={activeTab === 'venues' ? 'Search venues' : 'Search devices'} placeholder={activeTab === 'venues' ? 'Search venues...' : 'Search devices or venues...'} value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
      </div>

      {activeTab === 'venues' ? (
        <div className="space-y-5">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Add a venue</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleAddVenue} className="flex flex-col gap-3 sm:flex-row">
                <Input aria-label="Venue name" placeholder="Venue name (e.g. Hall A)" value={venueName} onChange={(event) => setVenueName(event.target.value)} required className="h-11 rounded-xl" />
                <Button type="submit" disabled={saving || !venueName.trim()} className="h-11 shrink-0 rounded-xl"><Plus size={16} className="mr-2" /> Add venue</Button>
              </form>
            </CardContent>
          </Card>
          <Card className="overflow-hidden rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Venue directory</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading venues...</p> : filteredVenues.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{venues.length ? 'No venues match your search.' : 'No venues registered yet. Add your first venue above.'}</p> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead className="pl-5">ID</TableHead><TableHead>Venue name</TableHead><TableHead>Devices</TableHead><TableHead>Created</TableHead><TableHead className="text-right pr-5">Action</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredVenues.map((venue) => <TableRow key={venue.id}>
                    <TableCell className="pl-5 font-mono text-xs">{venue.id}</TableCell>
                    <TableCell className="font-medium">{venue.name}</TableCell>
                    <TableCell>{devices.filter((device) => String(device.venue_id) === String(venue.id)).length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{venue.created_at && !Number.isNaN(new Date(venue.created_at).getTime()) ? new Date(venue.created_at).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => navigate(`/venues/${venue.id}`)}>Manage</Button></TableCell>
                  </TableRow>)}</TableBody>
                </Table></div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-5">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Register a device</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleAddDevice} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(200px,1fr)_minmax(180px,0.8fr)_auto]">
                <Input aria-label="Device name" placeholder="Device name (e.g. Entrance Cam 1)" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required className="h-11 rounded-xl" />
                <select aria-label="Assign device to venue" className="h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" value={venueId} onChange={(event) => setVenueId(event.target.value)} required>
                  <option value="">Select venue</option>
                  {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
                </select>
                <Button type="submit" disabled={saving || !deviceName.trim() || !venueId} className="h-11 rounded-xl"><Plus size={16} className="mr-2" /> Add device</Button>
              </form>
              {venues.length === 0 && <p className="mt-3 text-sm text-amber-700">Create a venue before registering a device.</p>}
            </CardContent>
          </Card>
          <Card className="overflow-hidden rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Device directory</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading devices...</p> : filteredDevices.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{devices.length ? 'No devices match your search.' : 'No devices registered yet. Add your first device above.'}</p> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead className="pl-5">ID</TableHead><TableHead>Device name</TableHead><TableHead>Venue</TableHead><TableHead>Status</TableHead><TableHead className="text-right pr-5">Action</TableHead></TableRow></TableHeader>
                  <TableBody>{filteredDevices.map((device) => <TableRow key={device.id}>
                    <TableCell className="pl-5 font-mono text-xs">{device.id}</TableCell>
                    <TableCell className="font-medium">{device.name}</TableCell>
                    <TableCell>{venues.find((venue) => String(venue.id) === String(device.venue_id))?.name || 'Unknown venue'}</TableCell>
                    <TableCell><Badge variant={String(device.status).toLowerCase() === 'active' ? 'default' : 'secondary'}>{device.status || 'Unknown'}</Badge></TableCell>
                    <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => navigate(`/devices/${device.id}`)}>Manage</Button></TableCell>
                  </TableRow>)}</TableBody>
                </Table></div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
