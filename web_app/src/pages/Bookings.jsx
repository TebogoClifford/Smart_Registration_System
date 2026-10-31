import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import EditBookingDialog from '@/components/EditBookingDialog';
import ExamDatePicker from '@/components/ExamDatePicker';
import { parseDate } from '@/lib/exams';
import { api } from '@/lib/api';
import { useDraft } from '@/lib/drafts';

const SLOTS = [{ value: '09:00', label: '09:00 session' }, { value: '13:00', label: '13:00 session' }];

// Book an exam hall for a module. Every student enrolled in the module gets a seat reserved.
// Several modules may share one hall in the same session as long as all the seats fit.
export default function Bookings() {
  const [searchParams] = useSearchParams();
  const [modules, setModules] = useState([]);
  const [venues, setVenues] = useState([]);
  const [bookings, setBookings] = useState([]);
  // the booking form and an open Edit exam dialog are kept when you leave the page and come back
  const [moduleId, setModuleId, moduleDraft] = useDraft('book:module', '');
  const [venueId, setVenueId] = useDraft('book:venue', '');
  const [date, setDate] = useDraft('book:date', '');
  const [slot, setSlot] = useDraft('book:slot', '09:00');
  const [avail, setAvail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [seatList, setSeatList] = useState([]);
  const [editing, setEditing] = useDraft('book:editing', null); // booking open in the Edit exam dialog

  // ?date=YYYY-MM-DD comes from the exam calendar's "Book an exam on this day" and wins over a draft
  const dateParam = searchParams.get('date') ?? '';
  useEffect(() => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) setDate(dateParam); }, [dateParam, setDate]);

  const loadBookings = useCallback(async () => {
    try { setBookings(await api.getBookings()); } catch (err) { toast.error(err.message); }
  }, []);
  const loadAll = useCallback(async () => {
    try {
      const [m, v] = await Promise.all([api.getModules(), api.getVenues()]);
      setModules(m); setVenues(v);
    } catch (err) { toast.error(err.message); }
    loadBookings();
  }, [loadBookings]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // Live "seats left" for the chosen hall, day and session.
  const loadAvail = useCallback(async () => {
    if (!venueId || !date) { setAvail(null); return; }
    try { setAvail(await api.getAvailability(venueId, date, slot)); } catch (err) { setAvail(null); toast.error(err.message); }
  }, [venueId, date, slot]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const mod = modules.find((m) => String(m.id) === moduleId);
  const needed = mod?.student_count ?? 0;
  const short = avail && mod ? needed - avail.remaining : 0;
  const alreadyBooked = avail && mod && avail.bookings.some((b) => b.code === mod.code);
  const problem = !mod || !avail ? '' :
    avail.capacity < 1 ? 'This venue has no capacity set. Edit the venue first.' :
    needed === 0 ? `${mod.code} has no enrolled students yet.` :
    alreadyBooked ? `${mod.code} is already booked for this session.` :
    short > 0 ? `Not enough seats: ${mod.code} needs ${needed} but only ${avail.remaining} are free (${short} short).` : '';
  const canBook = !!mod && !!avail && !problem && !saving;

  const book = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const b = await api.createBooking(Number(moduleId), Number(venueId), date, slot);
      toast.success(`${b.module_code} booked: ${b.seats} seats reserved, ${b.remaining} left in ${b.venue_name}`);
      if (b.notReadyAtVenue?.length) {
        toast.warning(`${b.notReadyAtVenue.length} seated student(s) are not enrolled on a device at this venue yet and will be refused at the door.`, { duration: 10000 });
      }
      moduleDraft.reset(''); // booked: the module choice is done; hall, date and session stay for the next one
      loadAll(); loadAvail();
    } catch (err) { toast.error(err.message); loadAvail(); } finally { setSaving(false); }
  };

  const cancel = async (id) => {
    try { await api.cancelBooking(id); toast.success('Booking cancelled, seats freed'); setExpanded(null); loadAll(); loadAvail(); } catch (err) { toast.error(err.message); }
  };

  const toggleSeats = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    try { const d = await api.getBooking(id); setSeatList(d.seatList); setExpanded(id); } catch (err) { toast.error(err.message); }
  };

  const moduleItems = useMemo(() => modules.map((m) => ({ value: String(m.id), label: `${m.code} — ${m.name} (${m.student_count} students)` })), [modules]);
  const venueItems = useMemo(() => venues.map((v) => ({ value: String(v.id), label: `${v.name} (${v.capacity} seats)` })), [venues]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Book an exam venue</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={book} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-1">
                <label className="text-sm font-medium">Module</label>
                <Select value={moduleId} onValueChange={setModuleId} items={moduleItems}>
                  <SelectTrigger aria-label="Module" className="w-full"><SelectValue placeholder="Choose a module" /></SelectTrigger>
                  <SelectContent>{moduleItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1">
                <label className="text-sm font-medium">Venue</label>
                <Select value={venueId} onValueChange={setVenueId} items={venueItems}>
                  <SelectTrigger aria-label="Venue" className="w-full"><SelectValue placeholder="Choose a venue" /></SelectTrigger>
                  <SelectContent>{venueItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1">
                <label className="text-sm font-medium">Session</label>
                <Select value={slot} onValueChange={setSlot} items={SLOTS}>
                  <SelectTrigger aria-label="Session" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{SLOTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-sm">
                <span className="font-medium">Date: </span>
                {date ? parseDate(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : <span className="text-muted-foreground">pick a day in the calendar</span>}
              </p>

            <div className="rounded-md border bg-muted/40 p-4 text-sm" aria-live="polite">
              {!avail ? (
                <span className="text-muted-foreground">Choose a venue and date to see how many seats are left.</span>
              ) : (
                <div className="space-y-2">
                  <p className="font-semibold">
                    {avail.venueName} · {avail.date} · {avail.slot}: <span data-testid="seats-left">{avail.remaining}</span> of {avail.capacity} seats free
                  </p>
                  <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${avail.capacity ? Math.min(100, (avail.reserved / avail.capacity) * 100) : 0}%` }} /></div>
                  {avail.bookings.length > 0 && <p className="text-muted-foreground">Already in this hall: {avail.bookings.map((b) => `${b.code} (${b.seats})`).join(', ')}</p>}
                  {mod && !problem && <p className="text-emerald-700">{mod.code} needs {needed} seats and fits ({avail.remaining - needed} would remain).</p>}
                  {problem && <p className="text-rose-700">{problem}</p>}
                </div>
              )}
            </div>
            <Button type="submit" disabled={!canBook}>Book venue and reserve seats</Button>
            </div>
            {/* which days work for this module, hall and session */}
            <div className="min-w-0">
              <p className="mb-2 text-sm font-medium">Date</p>
              <ExamDatePicker moduleId={moduleId} venueId={venueId} slot={slot} value={date} onChange={setDate} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bookings ({bookings.length})</CardTitle></CardHeader>
        <CardContent>
          {bookings.length === 0 ? <p className="py-8 text-center text-muted-foreground">No exam bookings yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Session</TableHead><TableHead>Module</TableHead><TableHead>Venue</TableHead><TableHead>Seats</TableHead><TableHead>Hall left</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {bookings.map((b) => (
                  <Fragment key={b.id}>
                    <TableRow>
                      <TableCell>{b.exam_date}</TableCell>
                      <TableCell><Badge variant="secondary">{b.slot}</Badge></TableCell>
                      <TableCell><span className="font-mono text-xs">{b.module_code}</span> <span className="text-muted-foreground">{b.module_name}</span></TableCell>
                      <TableCell>{b.venue_name}</TableCell>
                      <TableCell>{b.seats}</TableCell>
                      <TableCell>{b.remaining} / {b.venue_capacity}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => toggleSeats(b.id)}>{expanded === b.id ? 'Hide seats' : 'Seats'}</Button>
                        <Button variant="outline" size="sm" onClick={() => setEditing(b)}>Edit</Button>
                        <ConfirmDeleteDialog label="Cancel booking" title="Cancel booking" itemName={`${b.module_code} on ${b.exam_date} at ${b.slot}`} onConfirm={() => cancel(b.id)} />
                      </TableCell>
                    </TableRow>
                    {expanded === b.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <div className="grid gap-x-6 gap-y-1 py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                            {seatList.map((s) => (
                              <div key={s.student_id} className="flex gap-2">
                                <span className="w-10 font-mono text-xs text-muted-foreground">#{s.seat_number}</span>
                                <span className="font-mono text-xs">{s.student_number}</span>
                                <span>{s.name}</span>
                                {!s.ready_at_venue && <span className="text-xs text-amber-700">not enrolled at venue</span>}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {editing && (
        <EditBookingDialog booking={editing} venues={venues} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setExpanded(null); loadAll(); loadAvail(); }} />
      )}
    </div>
  );
}
