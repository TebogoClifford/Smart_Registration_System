import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDraft, clearDrafts } from '@/lib/drafts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import ExamDatePicker from '@/components/ExamDatePicker';

const SLOTS = [{ value: '09:00', label: '09:00 session' }, { value: '13:00', label: '13:00 session' }];

// Move one exam booking (a module's sitting) to another hall, day or session. The server seats the
// module's students again; if they don't fit or someone has another exam then, nothing changes.
// `booking` is a row from GET /api/bookings; `onSaved(updatedRow)` runs after a successful move.
export default function EditBookingDialog({ booking, venues, onClose: close, onSaved }) {
  // kept while you visit other pages; dropped when you save or cancel
  const k = `bookedit:${booking.id}:`;
  const [venueId, setVenueId] = useDraft(`${k}venue`, String(booking.venue_id));
  const [date, setDate] = useDraft(`${k}date`, booking.exam_date);
  const [slot, setSlot] = useDraft(`${k}slot`, booking.slot);
  const [avail, setAvail] = useState(null);
  const [saving, setSaving] = useState(false);
  const onClose = useCallback(() => { clearDrafts(k); close(); }, [k, close]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let current = true;
    if (!venueId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setAvail(null); return undefined; }
    api.getAvailability(venueId, date, slot)
      .then((a) => { if (current) setAvail(a); })
      .catch(() => { if (current) setAvail(null); });
    return () => { current = false; };
  }, [venueId, date, slot]);

  const venueItems = useMemo(() => venues.map((v) => ({ value: String(v.id), label: `${v.name} (${v.capacity} seats)` })), [venues]);
  const unchanged = venueId === String(booking.venue_id) && date === booking.exam_date && slot === booking.slot;
  // this booking's own seats count as free when it stays in the same hall and session
  const own = avail?.bookings.find((b) => b.id === booking.id)?.seats ?? 0;
  const free = avail ? avail.remaining + own : null;
  const short = free !== null ? booking.seats - free : 0;
  const problem = !avail ? '' : avail.capacity < 1 ? 'This hall has no seat count yet.' : short > 0 ? `Not enough seats: ${booking.seats} needed, ${free} free (${short} short).` : '';

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const row = await api.updateBooking(booking.id, Number(venueId), date, slot);
      toast.success(`${booking.module_code} moved to ${row.venue_name}, ${row.exam_date} ${row.slot} · ${row.seats} seats`);
      clearDrafts(k);
      onSaved(row);
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="edit-booking-title" onSubmit={save}
        className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
        <div>
          <h3 id="edit-booking-title" className="text-lg font-bold">Edit exam</h3>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{booking.module_code}</span> {booking.module_name} · {booking.seats} students
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Hall</label>
          <Select value={venueId} onValueChange={setVenueId} items={venueItems}>
            <SelectTrigger aria-label="Hall" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{venueItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Session</label>
          <Select value={slot} onValueChange={setSlot} items={SLOTS}>
            <SelectTrigger aria-label="Session" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{SLOTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Date</p>
          {/* this exam's own seats and slot count as free, so its current day is not shown as taken */}
          <ExamDatePicker moduleId={booking.module_id} venueId={venueId} slot={slot} value={date} onChange={setDate} excludeBookingId={booking.id} />
        </div>
        <p aria-live="polite" className={`rounded-md border px-3 py-2 text-sm ${problem ? 'border-rose-200 bg-rose-50 text-rose-800' : 'bg-muted/40 text-muted-foreground'}`}>
          {unchanged ? 'Change the hall, date or session to move this exam.'
            : !avail ? 'Checking seats…'
              : problem || `${free} seats free in ${avail.venueName} then; ${booking.seats} needed. Students who already sit another exam then will be reported.`}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || unchanged || !avail || !!problem}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </div>
  );
}
