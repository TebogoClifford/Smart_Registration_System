import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { Plus, MapPin, Cpu, Search, RefreshCw, Wifi, WifiOff, CircleHelp, Activity, Clock3 } from 'lucide-react';

export default function VenueDeviceManagement() {
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [devices, setDevices] = useState([]);
  const [venueName, setVenueName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deviceMetricsUpdatedAt, setDeviceMetricsUpdatedAt] = useState(null);
  const [deviceMetricsError, setDeviceMetricsError] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [venueData, deviceData] = await Promise.all([api.getVenues(), api.getDevices()]);
      const venueList = Array.isArray(venueData) ? venueData : Array.isArray(venueData?.venues) ? venueData.venues : Array.isArray(venueData?.data) ? venueData.data : [];
      const deviceList = Array.isArray(deviceData) ? deviceData : Array.isArray(deviceData?.devices) ? deviceData.devices : Array.isArray(deviceData?.data) ? deviceData.data : [];
      setVenues(venueList);
      setDevices(deviceList);
    } catch (error) {
      toast.error('Failed to load venues and devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    const refreshDeviceMetrics = async () => {
      try {
        const response = await api.getDevices();
        const data = Array.isArray(response) ? response : Array.isArray(response?.devices) ? response.devices : Array.isArray(response?.data) ? response.data : null;
        if (!data) throw new Error('Unexpected device API response');
        if (!cancelled) {
          setDevices(data);
          setDeviceMetricsUpdatedAt(new Date());
          setDeviceMetricsError(false);
        }
      } catch (error) {
        if (!cancelled) setDeviceMetricsError(true);
      }
    };
    refreshDeviceMetrics();
    const timer = window.setInterval(refreshDeviceMetrics, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const connectionState = (device) => {
    const rawStatus = device.connection_status ?? device.connectionState ?? device.status ?? device.connection_state ?? '';
    const status = String(rawStatus).trim().toLowerCase().replace(/[ _]+/g, '-');
    if (device.is_online === true || device.is_connected === true || device.connected === true) return 'online';
    if (device.is_online === false || device.is_connected === false || device.connected === false) return 'offline';
    if (['online', 'connected', 'ready', 'active', 'operational', 'healthy'].includes(status)) return 'online';
    if (['offline', 'disconnected', 'unreachable', 'inactive', 'error', 'failed'].includes(status)) return 'offline';
    return 'unknown';
  };

  const onlineDevices = devices.filter((device) => connectionState(device) === 'online');
  const offlineDevices = devices.filter((device) => connectionState(device) === 'offline');
  const unknownDevices = devices.filter((device) => connectionState(device) === 'unknown');

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

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="max-w-2xl text-sm text-muted-foreground">Manage exam locations and the access devices installed at each venue.</p>
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
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search venues and devices" placeholder="Search venues and devices..." value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
      </div>

      
      <div className="space-y-6">
<div className="grid grid-cols-1 items-start gap-5">
          <div className="min-w-0 space-y-5">
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
                      <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => navigate('/venues/' + venue.id)}>Manage</Button></TableCell>
                    </TableRow>)}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Activity size={18} className="text-primary" /> Connected devices</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Device status reported by the system</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  <span className={'h-2 w-2 rounded-full ' + (deviceMetricsError ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse')} />
                  {deviceMetricsError ? 'Update issue' : 'Auto-refresh'}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border bg-emerald-50/70 p-3 dark:bg-emerald-950/20">
                  <Wifi size={17} className="mb-2 text-emerald-600" />
                  <p className="text-2xl font-bold tabular-nums">{onlineDevices.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Online</p>
                </div>
                <div className="rounded-xl border bg-rose-50/70 p-3 dark:bg-rose-950/20">
                  <WifiOff size={17} className="mb-2 text-rose-600" />
                  <p className="text-2xl font-bold tabular-nums">{offlineDevices.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Offline</p>
                </div>
                <div className="rounded-xl border bg-muted/40 p-3">
                  <CircleHelp size={17} className="mb-2 text-muted-foreground" />
                  <p className="text-2xl font-bold tabular-nums">{unknownDevices.length}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Unknown</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Device status</h3>
                <span className="text-xs text-muted-foreground">{devices.length} registered</span>
              </div>
              {devices.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                  <Cpu size={24} className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">No devices registered</p>
                  <p className="mt-1 text-xs text-muted-foreground">Add a device to see its reported status here.</p>
                  <Button variant="outline" size="sm" onClick={() => document.getElementById('device-management')?.scrollIntoView({ behavior: 'smooth' })} className="mt-4">Register a device</Button>
                </div>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {devices.map((device) => {
                    const state = connectionState(device);
                    const venue = venues.find((item) => String(item.id) === String(device.venue_id));
                    const reportedStatus = device.status ?? device.connection_status ?? 'Status unavailable';
                    return (
                      <button key={device.id} type="button" onClick={() => navigate('/devices/' + device.id)} className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40">
                        <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' + (state === 'online' ? 'bg-emerald-100 text-emerald-700' : state === 'offline' ? 'bg-rose-100 text-rose-700' : 'bg-muted text-muted-foreground')}>
                          {state === 'online' ? <Wifi size={17} /> : state === 'offline' ? <WifiOff size={17} /> : <CircleHelp size={17} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{device.name || ('Device ' + device.id)}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{venue?.name || 'Unassigned venue'} · {reportedStatus}</span>
                        </span>
                        <span className={'h-2 w-2 shrink-0 rounded-full ' + (state === 'online' ? 'bg-emerald-500' : state === 'offline' ? 'bg-rose-500' : 'bg-slate-300')} />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
                <Clock3 size={14} />
                {deviceMetricsError ? 'Could not refresh device metrics.' : deviceMetricsUpdatedAt ? 'Last updated ' + deviceMetricsUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · refreshes every 10s' : 'Loading live device status…'}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Metrics refresh from the devices API every 10 seconds. Status values such as active/operational count as online; devices without a recognized status remain unknown.</p>
            </CardContent>
          </Card>
        </div>
<div id="device-management" className="space-y-5">
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
      </div>
    </div>
  );
}
