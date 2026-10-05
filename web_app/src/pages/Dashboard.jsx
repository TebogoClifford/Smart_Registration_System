import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { RefreshCcw, Wifi, WifiOff, AlertCircle, Download, Filter, UserPlus } from 'lucide-react';

function StatusIndicator({ status }) {
  const config = {
    live: { color: 'text-green-500', bg: 'bg-green-500', label: 'Live', icon: <Wifi size={14} /> },
    reconnecting: { color: 'text-amber-500', bg: 'bg-amber-500', label: 'Reconnecting...', icon: <RefreshCcw size={14} className="animate-spin" /> },
    offline: { color: 'text-red-500', bg: 'bg-red-500', label: 'Offline', icon: <WifiOff size={14} /> },
  };

  const { color, bg, label, icon } = config[status] || config.offline;

  return (
    <div
      className="flex items-center gap-2 text-sm font-medium"
      aria-live="polite"
    >
      <span className={`relative flex h-2 w-2`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${bg}`}></span>
        <span className={`relative inline-flex rounded-full h-2 w-2 ${bg}`}></span>
      </span>
      <span className={color}>{label}</span>
    </div>
  );
}

function StatCard({ label, value, colorClass, subtext }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className={`text-3xl font-bold tabular-nums ${colorClass}`}>{value}</span>
          {subtext && <span className="text-xs text-muted-foreground">{subtext}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 w-full">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 bg-muted/50 animate-pulse rounded-lg">
          <div className="h-4 w-20 bg-muted-foreground/20 rounded" />
          <div className="h-4 w-24 bg-muted-foreground/20 rounded" />
          <div className="h-4 w-32 bg-muted-foreground/20 rounded" />
          <div className="h-4 w-16 bg-muted-foreground/20 rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('live');
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('today');

  const fetchEvents = async () => {
    try {
      const data = await api.getAccessEvents();
      setEvents(data);
      setFilteredEvents(data);
      setConnectionStatus('live');
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('Failed to fetch events:', err);
      setConnectionStatus('offline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let filtered = [...events];
    if (decisionFilter === 'denied') {
      filtered = events.filter(e => e.decision?.toLowerCase() === 'denied');
    }
    setFilteredEvents(filtered);
  }, [decisionFilter, events]);

  const handleExportCSV = () => {
    const headers = ['Time,Student ID,Device ID,Decision\n'];
    const rows = filteredEvents.map(e =>
      `${new Date(e.event_time).toLocaleString()},${e.student_id || 'N/A'},${e.device_id},${e.decision}`
    );
    const csvContent = "data:text/csv;charset=utf-8," + headers.concat(rows).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `access_log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getDecisionBadge = (decision) => {
    switch (decision?.toLowerCase()) {
      case 'granted':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200 flex items-center gap-1 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-green-600" /> Granted
          </Badge>
        );
      case 'denied':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 flex items-center gap-1 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600" /> Denied
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" /> {decision || 'Review'}
          </Badge>
        );
    }
  };

  const stats = {
    granted: events.filter(e => e.decision === 'granted').length,
    denied: events.filter(e => e.decision === 'denied').length,
    errors: events.filter(e => e.decision !== 'granted' && e.decision !== 'denied').length,
    enrolled: "142/150"
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-[28px] font-bold tracking-tight">Live access feed</h2>
          <p className="text-muted-foreground font-medium">
            Venue: <span className="text-foreground">Main Hall A</span> · Device: <span className="text-foreground">Entrance Cam 01</span>
          </p>
        </div>
        <StatusIndicator status={connectionStatus} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Granted"
          value={stats.granted}
          colorClass="text-green-600"
        />
        <StatCard
          label="Denied"
          value={stats.denied}
          colorClass="text-red-600"
        />
        <StatCard
          label="Errors"
          value={stats.errors}
          colorClass="text-amber-600"
        />
        <StatCard
          label="Enrolled"
          value={stats.enrolled}
          colorClass="text-primary"
        />
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-col gap-4 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Recent Events</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
               Updated {Math.floor((Date.now() - lastUpdated)/1000)}s ago
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-muted-foreground" />
              <Select value={decisionFilter} onValueChange={setDecisionFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Filter Decision" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Decisions</SelectItem>
                  <SelectItem value="denied">Denied Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFilter === 'today' ? new Date().toISOString().split('T')[0] : dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
            </div>
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 text-xs gap-2">
                <Download size={14} /> Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && events.length === 0 ? (
            <TableSkeleton />
          ) : events.length === 0 ? (
            <div className="py-20 text-center space-y-6">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <AlertCircle size={32} />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-medium">No access events recorded yet.</p>
                <p className="text-muted-foreground text-sm">Events will appear here when a student is scanned.</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => window.location.href='/enroll'}>
                <UserPlus size={16} /> Go to Enroll
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Time</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Device ID</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Student ID</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Decision</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => {
                  const isDenied = event.decision?.toLowerCase() === 'denied';
                  const isError = event.decision !== 'granted' && event.decision !== 'denied';

                  return (
                    <TableRow
                      key={event.id}
                      className={`h-[56px] transition-all duration-500 motion-safe:animate-in fade-in ${
                        isDenied ? 'bg-red-50/50 border-l-4 border-l-red-500' : ''
                      }`}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">
                        {new Date(event.event_time).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>{event.device_id}</TableCell>
                      <TableCell>{event.student_id || 'N/A'}</TableCell>
                      <TableCell>{getDecisionBadge(event.decision)}</TableCell>
                      <TableCell className="text-right">
                        {isDenied && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs hover:bg-red-100 hover:text-red-700">
                            Override
                          </Button>
                        )}
                        {isError && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs hover:bg-amber-100 hover:text-amber-700">
                            Review
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}