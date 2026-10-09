import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  RefreshCcw, Wifi, WifiOff, AlertCircle, Download, Filter, UserPlus, Search,
  Users, CheckCircle2, XCircle, Activity, TrendingUp, MapPin, ArrowUpRight
} from 'lucide-react';

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeEvent = (event) => ({
  ...event,
  // The API currently returns camelCase fields. Accept legacy snake_case too.
  event_time: event.event_time ?? event.timestamp ?? null,
  student_id: event.student_id ?? event.studentId ?? null,
  device_id: event.device_id ?? event.deviceId ?? null,
});

function StatusIndicator({ status }) {
  const settings = {
    live: { label: 'Live data', color: 'text-emerald-700', dot: 'bg-emerald-500', Icon: Wifi },
    reconnecting: { label: 'Updating', color: 'text-amber-700', dot: 'bg-amber-500', Icon: RefreshCcw },
    offline: { label: 'Connection issue', color: 'text-rose-700', dot: 'bg-rose-500', Icon: WifiOff },
  };
  const item = settings[status] || settings.offline;
  const Icon = item.Icon;
  return (
    <div aria-live="polite" className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold ${item.color}`}>
      <span className={`h-2 w-2 rounded-full ${item.dot}`} />
      <Icon size={14} className={status === 'reconnecting' ? 'animate-spin' : ''} />
      {item.label}
    </div>
  );
}

function StatCard({ label, value, detail, Icon, tone, footer }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    red: 'bg-rose-50 text-rose-700 ring-rose-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  };
  return (
    <Card className="group rounded-2xl border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950 tabular-nums">{value}</p>
          </div>
          <div className={`rounded-xl p-3 ring-1 ${tones[tone]}`}><Icon size={20} /></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">{detail}</p>
        {footer && <div className="mt-4 border-t border-slate-100 pt-3">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function DailyTrendChart({ data, loading }) {
  const max = Math.max(1, ...data.map((day) => Number(day.total) || 0));
  if (loading && data.length === 0) {
    return <div className="flex h-56 items-end gap-3 px-2 pb-6 pt-5" aria-label="Loading daily activity chart">
      {[42, 70, 55, 85, 48, 76, 62].map((height, index) => <div key={index} className="flex flex-1 flex-col justify-end gap-2">
        <div className="animate-pulse rounded-t-md bg-slate-100" style={{ height: `${height}%` }} />
        <div className="mx-auto h-2 w-7 animate-pulse rounded bg-slate-100" />
      </div>)}
    </div>;
  }
  if (!data.length || data.every((day) => Number(day.total) === 0)) {
    return <div className="flex h-56 flex-col items-center justify-center text-center">
      <div className="rounded-2xl bg-slate-50 p-3 text-slate-400"><TrendingUp size={22} /></div>
      <p className="mt-3 text-sm font-semibold text-slate-700">No activity to chart yet</p>
      <p className="mt-1 text-xs text-slate-500">Access events from the last seven days will appear here.</p>
    </div>;
  }
  return (
    <div className="pt-3">
      <div className="flex h-52 items-end gap-2 border-b border-slate-100 px-1 sm:gap-4">
        {data.map((day) => {
          const granted = Number(day.granted) || 0;
          const denied = Number(day.denied) || 0;
          const other = Math.max(0, (Number(day.total) || 0) - granted - denied);
          const totalHeight = Math.max(3, ((Number(day.total) || 0) / max) * 100);
          const grantedHeight = ((granted / max) * 100);
          const deniedHeight = ((denied / max) * 100);
          const otherHeight = ((other / max) * 100);
          return (
            <div key={day.date} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="mb-2 text-center text-[11px] font-semibold tabular-nums text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">{day.total}</div>
              <div className="flex w-full items-end justify-center" style={{ height: 'calc(100% - 20px)' }} title={`${day.label}: ${day.total} attempts · ${granted} granted · ${denied} denied`}>
                <div className="flex w-full max-w-10 flex-col justify-end overflow-hidden rounded-t-lg bg-slate-100" style={{ height: `${totalHeight}%`, minHeight: '3px' }}>
                  {other > 0 && <div className="w-full bg-amber-400" style={{ height: `${(otherHeight / totalHeight) * 100}%` }} />}
                  {denied > 0 && <div className="w-full bg-rose-400" style={{ height: `${(deniedHeight / totalHeight) * 100}%` }} />}
                  {granted > 0 && <div className="w-full bg-blue-600" style={{ height: `${(grantedHeight / totalHeight) * 100}%` }} />}
                </div>
              </div>
              <span className="mt-3 truncate pb-3 text-center text-[11px] font-medium text-slate-500">{day.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> Granted</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> Denied</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Other</span>
      </div>
    </div>
  );
}

function VenueBreakdown({ venues, loading }) {
  const max = Math.max(1, ...venues.map((venue) => Number(venue.attempts) || 0));
  if (loading && venues.length === 0) return <div className="space-y-5 py-3">{[1, 2, 3, 4].map((item) => <div key={item} className="animate-pulse space-y-2"><div className="h-3 w-28 rounded bg-slate-100" /><div className="h-2 rounded-full bg-slate-100" /></div>)}</div>;
  if (!venues.length) return <div className="flex h-44 flex-col items-center justify-center text-center"><MapPin size={22} className="text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No venues available</p><p className="mt-1 text-xs text-slate-500">Add a venue to see its activity.</p></div>;
  return <div className="space-y-5 py-2">
    {venues.map((venue) => (
      <div key={venue.id}>
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-medium text-slate-700">{venue.name}</span>
          <span className="shrink-0 font-semibold tabular-nums text-slate-900">{venue.attempts}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-400 transition-all" style={{ width: `${Math.min(100, ((Number(venue.attempts) || 0) / max) * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-400">{venue.granted} granted · {venue.denied} denied in the last 7 days</p>
      </div>
    ))}
  </div>;
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
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('reconnecting');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState(localDate());
  const [searchTerm, setSearchTerm] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [statsWarning, setStatsWarning] = useState('');

  const fetchDashboard = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const data = await api.getAccessEvents();
      setEvents(Array.isArray(data) ? data.map(normalizeEvent) : []);
      setConnectionStatus('live');
      setLastUpdated(Date.now());
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to refresh access events:', error);
      setConnectionStatus('offline');
      setErrorMessage('Unable to refresh access events. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Analytics are supplementary: a stats failure should not hide the access-event feed.
    try {
      const summary = await api.getStats();
      setAnalytics(summary && typeof summary === 'object' ? summary : null);
      setStatsWarning('');
    } catch (error) {
      console.error('Failed to load dashboard analytics:', error);
      setStatsWarning('Analytics could not be refreshed. Showing available event data where possible.');
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const poll = window.setInterval(() => fetchDashboard(), 15000);
    const ticker = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(ticker); };
  }, [fetchDashboard]);

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

  const fallbackStats = useMemo(() => {
    const today = events.filter((event) => event.event_time && localDate(new Date(event.event_time)) === localDate());
    return {
      total: today.length,
      granted: today.filter((event) => String(event.decision).toLowerCase() === 'granted').length,
      denied: today.filter((event) => String(event.decision).toLowerCase() === 'denied').length,
      errors: today.filter((event) => !['granted', 'denied'].includes(String(event.decision).toLowerCase())).length,
    };
  }, [events]);

  const summary = analytics || {};
  const todayStats = {
    total: Number(summary.total ?? (fallbackStats.total || 0)),
    granted: Number(summary.granted ?? fallbackStats.granted),
    denied: Number(summary.denied ?? fallbackStats.denied),
    errors: Number(summary.errors ?? fallbackStats.errors),
  };
  const totalStudents = summary.totalStudents == null ? null : Number(summary.totalStudents);
  const enrolled = Number(summary.enrolled || 0);
  const enrollmentRate = Number(summary.enrollmentRate ?? (totalStudents ? Math.round((enrolled / totalStudents) * 100) : 0));
  const dailyTrend = Array.isArray(summary.dailyTrend) ? summary.dailyTrend : [];
  const topVenues = Array.isArray(summary.topVenues) ? summary.topVenues : [];

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
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const decisionBadge = (decision) => {
    const value = String(decision || 'Review');
    if (value.toLowerCase() === 'granted') return <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">●&nbsp; Granted</Badge>;
    if (value.toLowerCase() === 'denied') return <Badge className="border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">●&nbsp; Denied</Badge>;
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{value}</Badge>;
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-6 text-white shadow-sm sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-2 -top-12 h-48 w-48 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">Operations overview</p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-blue-100/80">A live view of student access, registration progress, and venue activity.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusIndicator status={connectionStatus} />
            <Button variant="secondary" onClick={() => fetchDashboard(true)} disabled={refreshing} className="gap-2 rounded-xl border border-white/10 bg-white text-slate-900 hover:bg-blue-50">
              <RefreshCcw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh data
            </Button>
            <Button onClick={() => navigate('/enroll')} className="gap-2 rounded-xl bg-blue-500 text-white hover:bg-blue-400">
              <UserPlus size={16} /> Enrol student
            </Button>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/15 pt-4 text-xs text-blue-100/80">
          <span className="inline-flex items-center gap-2"><Activity size={14} /> Live access monitoring</span>
          <span className="inline-flex items-center gap-2"><TrendingUp size={14} /> 7-day analytics</span>
          <span>Last refreshed {lastUpdated ? `${Math.max(0, Math.floor((clock - lastUpdated) / 1000))} seconds ago` : '—'}</span>
        </div>
      </section>

      {errorMessage && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2"><AlertCircle size={17} />{errorMessage}</span>
        <Button variant="outline" size="sm" onClick={() => fetchDashboard(true)} className="border-rose-200 bg-white">Try again</Button>
      </div>}
      {statsWarning && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{statsWarning}</p>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today's registration and access metrics">
        <StatCard label="Access attempts" value={todayStats.total.toLocaleString()} detail="Today · all recorded decisions" Icon={Activity} tone="blue" />
        <StatCard label="Access granted" value={todayStats.granted.toLocaleString()} detail="Successful access checks" Icon={CheckCircle2} tone="green" />
        <StatCard label="Access denied" value={todayStats.denied.toLocaleString()} detail="Denied access checks" Icon={XCircle} tone="red" />
        <StatCard label="Registered students" value={totalStudents === null ? '—' : totalStudents.toLocaleString()} detail={totalStudents === null ? 'Student directory total' : `${enrolled.toLocaleString()} enrolled · ${Math.max(0, totalStudents - enrolled).toLocaleString()} not yet enrolled`} Icon={Users} tone="violet"
          footer={totalStudents !== null && <><div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500"><span>Enrollment progress</span><span className="font-semibold text-slate-700">{enrollmentRate}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, enrollmentRate))}%` }} /></div></>} />
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-1">
            <div><CardTitle className="text-base font-bold text-slate-900">Access activity</CardTitle><p className="mt-1 text-xs text-slate-500">Daily access decisions over the last 7 days</p></div>
            <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><TrendingUp size={18} /></span>
          </CardHeader>
          <CardContent><DailyTrendChart data={dailyTrend} loading={loading} /></CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-1">
            <div><CardTitle className="text-base font-bold text-slate-900">Venue activity</CardTitle><p className="mt-1 text-xs text-slate-500">Top venues by access attempts · 7 days</p></div>
            <span className="rounded-lg bg-violet-50 p-2 text-violet-700"><MapPin size={18} /></span>
          </CardHeader>
          <CardContent><VenueBreakdown venues={topVenues} loading={loading} /></CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm">
        <CardHeader className="gap-4 border-b border-slate-100 bg-white p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">Recent access events</CardTitle>
              <p className="mt-1 text-xs text-slate-500">{filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'} shown · latest events refresh automatically</p>
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
            filteredEvents.length === 0 ? <div className="flex flex-col items-center px-6 py-14 text-center">
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
        <span>Smart Registration System · Analytics are based on recorded database events.</span>
        <button type="button" onClick={() => navigate('/venues')} className="inline-flex items-center gap-1 font-semibold text-blue-700 transition-colors hover:text-blue-900">Manage venues and devices <ArrowUpRight size={13} /></button>
      </div>
    </div>
  );
}
