import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { RefreshCcw, Wifi, WifiOff, AlertCircle, Download, Filter, UserPlus, Search, Users, CheckCircle2, XCircle, Activity } from 'lucide-react';

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function StatusIndicator({ status }) {
  const settings = {
    live: { label: 'Connected', color: 'text-emerald-700', dot: 'bg-emerald-500', Icon: Wifi },
    reconnecting: { label: 'Updating', color: 'text-amber-700', dot: 'bg-amber-500', Icon: RefreshCcw },
    offline: { label: 'Connection issue', color: 'text-rose-700', dot: 'bg-rose-500', Icon: WifiOff },
  };
  const item = settings[status] || settings.offline;
  const Icon = item.Icon;
  return (
    <div aria-live="polite" className={`inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-xs font-semibold ${item.color}`}>
      <span className={`h-2 w-2 rounded-full ${item.dot}`} />
      <Icon size={14} className={status === 'reconnecting' ? 'animate-spin' : ''} />
      {item.label}
    </div>
  );
}

function StatCard({ label, value, detail, Icon, tone }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950 tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-xl p-3 ${tones[tone]}`}><Icon size={21} /></div>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return <div className="space-y-3 p-2" aria-label="Loading events">
    {[...Array(5)].map((_, i) => <div key={i} className="flex animate-pulse items-center gap-4 rounded-xl bg-slate-50 p-4">
      <div className="h-4 w-24 rounded bg-slate-200" /><div className="h-4 w-20 rounded bg-slate-200" /><div className="h-4 w-32 rounded bg-slate-200" /><div className="ml-auto h-6 w-20 rounded-full bg-slate-200" />
    </div>)}
  </div>;
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [studentCount, setStudentCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('reconnecting');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState(localDate());
  const [searchTerm, setSearchTerm] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchEvents = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [eventData, studentData] = await Promise.all([
        api.getAccessEvents(),
        studentCount === null ? api.getStudents() : Promise.resolve(null),
      ]);
      setEvents(Array.isArray(eventData) ? eventData : []);
      if (Array.isArray(studentData)) setStudentCount(studentData.length);
      setConnectionStatus('live');
      setLastUpdated(Date.now());
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
      setConnectionStatus('offline');
      setErrorMessage('Unable to refresh dashboard data. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentCount]);

  useEffect(() => {
    fetchEvents();
    const poll = setInterval(() => fetchEvents(), 10000);
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(ticker); };
  }, [fetchEvents]);

  const filteredEvents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return events.filter((event) => {
      const decision = String(event.decision || '').toLowerCase();
      const eventDay = event.event_time ? localDate(new Date(event.event_time)) : '';
      const matchesDecision = decisionFilter === 'all' || decision === decisionFilter;
      const matchesDate = !dateFilter || eventDay === dateFilter;
      const matchesSearch = !query || [event.student_id, event.device_id, event.decision, event.id]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
      return matchesDecision && matchesDate && matchesSearch;
    });
  }, [events, searchTerm, decisionFilter, dateFilter]);

  const stats = useMemo(() => {
    const todaysEvents = events.filter((event) => event.event_time && localDate(new Date(event.event_time)) === localDate());
    const granted = todaysEvents.filter((event) => String(event.decision).toLowerCase() === 'granted').length;
    const denied = todaysEvents.filter((event) => String(event.decision).toLowerCase() === 'denied').length;
    return { total: todaysEvents.length, granted, denied };
  }, [events]);

  const exportCSV = () => {
    const rows = [
      ['Time', 'Student ID', 'Device ID', 'Decision', 'Event ID'],
      ...filteredEvents.map((event) => [
        event.event_time ? new Date(event.event_time).toLocaleString() : '',
        event.student_id || 'N/A', event.device_id || 'N/A', event.decision || 'Unknown', event.id ?? '',
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `access-events-${localDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const decisionBadge = (decision) => {
    const value = String(decision || 'Review');
    if (value.toLowerCase() === 'granted') return <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">●&nbsp; Granted</Badge>;
    if (value.toLowerCase() === 'denied') return <Badge className="border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">●&nbsp; Denied</Badge>;
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{value}</Badge>;
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Smart Registration System</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-500">Monitor student access and venue activity in real time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusIndicator status={connectionStatus} />
          <Button variant="outline" onClick={() => fetchEvents(true)} disabled={refreshing} className="gap-2 rounded-xl">
            <RefreshCcw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </Button>
          <Button onClick={() => navigate('/enroll')} className="gap-2 rounded-xl"><UserPlus size={16} /> Enrol student</Button>
        </div>
      </section>

      {errorMessage && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2"><AlertCircle size={17} />{errorMessage}</span>
        <Button variant="outline" size="sm" onClick={() => fetchEvents(true)} className="border-rose-200 bg-white">Try again</Button>
      </div>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today's access statistics">
        <StatCard label="Access attempts" value={stats.total} detail="Recorded today" Icon={Activity} tone="blue" />
        <StatCard label="Access granted" value={stats.granted} detail="Successful scans today" Icon={CheckCircle2} tone="green" />
        <StatCard label="Access denied" value={stats.denied} detail="Denied scans today" Icon={XCircle} tone="red" />
        <StatCard label="Registered students" value={studentCount === null ? '—' : studentCount} detail="Student directory total" Icon={Users} tone="amber" />
      </section>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="gap-4 border-b border-slate-100 bg-white p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-lg font-bold text-slate-900">Recent access events</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'} shown{lastUpdated ? ` · Updated ${Math.max(0, Math.floor((clock - lastUpdated) / 1000))}s ago` : ''}</p>
            </div>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={filteredEvents.length === 0} className="gap-2 rounded-lg"><Download size={15} /> Export CSV</Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_170px_180px]">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input aria-label="Search access events" placeholder="Search student, device, decision..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="h-10 rounded-xl border-slate-200 pl-9" />
            </div>
            <Select value={decisionFilter} onValueChange={setDecisionFilter}>
              <SelectTrigger className="h-10 rounded-xl border-slate-200"><Filter size={15} className="mr-2 text-slate-400" /><SelectValue placeholder="All decisions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All decisions</SelectItem>
                <SelectItem value="granted">Granted</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
              </SelectContent>
            </Select>
            <Input aria-label="Filter events by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-10 rounded-xl border-slate-200" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && events.length === 0 ? <div className="p-5"><TableSkeleton /></div> :
            filteredEvents.length === 0 ? <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-500"><AlertCircle size={28} /></div>
              <h3 className="font-semibold text-slate-900">{events.length === 0 ? 'No access events yet' : 'No matching events'}</h3>
              <p className="mt-2 max-w-sm text-sm text-slate-500">{events.length === 0 ? 'Events will appear here after a student is scanned at a registered device.' : 'Try changing the date, decision filter, or search term.'}</p>
              {events.length === 0
                ? <Button variant="outline" size="sm" onClick={() => navigate('/enroll')} className="mt-5 gap-2 rounded-lg"><UserPlus size={15} /> Enrol a student</Button>
                : <Button variant="outline" size="sm" onClick={() => { setSearchTerm(''); setDecisionFilter('all'); setDateFilter(localDate()); }} className="mt-5 rounded-lg">Clear filters</Button>}
            </div> :
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Time</TableHead>
                  <TableHead className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Device</TableHead>
                  <TableHead className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Student ID</TableHead>
                  <TableHead className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Decision</TableHead>
                  <TableHead className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Event ID</TableHead>
                </TableRow></TableHeader>
                <TableBody>{filteredEvents.map((event) => {
                  const denied = String(event.decision || '').toLowerCase() === 'denied';
                  return <TableRow key={event.id ?? `${event.event_time}-${event.device_id}-${event.student_id}`} className={`transition-colors hover:bg-slate-50/80 ${denied ? 'bg-rose-50/40' : ''}`}>
                    <TableCell className="whitespace-nowrap px-5 py-4">
                      <div className="font-medium text-slate-800">{event.event_time ? new Date(event.event_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{event.event_time ? new Date(event.event_time).toLocaleDateString() : ''}</div>
                    </TableCell>
                    <TableCell className="px-5 py-4 font-medium text-slate-700">{event.device_id ?? 'Unknown device'}</TableCell>
                    <TableCell className="px-5 py-4 font-mono text-xs text-slate-600">{event.student_id || 'N/A'}</TableCell>
                    <TableCell className="px-5 py-4">{decisionBadge(event.decision)}</TableCell>
                    <TableCell className="px-5 py-4 text-right font-mono text-xs text-slate-400">{event.id ?? '—'}</TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </div>}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-slate-400">Dashboard refreshes automatically every 10 seconds.</p>
    </div>
  );
}
