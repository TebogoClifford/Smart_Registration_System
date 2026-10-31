import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { localDate, parseDate, addDays, formatDay } from '@/lib/exams';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['09:00', '13:00'];
// unavailable days are hatched as well as muted, so they read without colour (print, colour blindness)
const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, rgb(241 245 249) 0 4px, rgb(226 232 240) 4px 6px)' };

function monthGrid(first) {
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// Pick an exam date and SEE which days work: for the chosen module, hall and session every day is
// marked available or not (too few seats, a student has another exam then, already booked, past),
// with both sessions shown as "09" / "13". excludeBookingId = the booking being moved.
export default function ExamDatePicker({ moduleId, venueId, slot, value, onChange, excludeBookingId }) {
  const [month, setMonth] = useState(() => { const d = parseDate(value || localDate()); return new Date(d.getFullYear(), d.getMonth(), 1, 12); });
  const [avail, setAvail] = useState(null); // { days: Map(date -> slots), needed, venueName }
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState(null); // the day being hovered (its reasons are shown below)
  const today = localDate();

  // follow the chosen date to its month (e.g. ?date= from the calendar)
  useEffect(() => {
    if (!value) return;
    const d = parseDate(value);
    setMonth((m) => (m.getMonth() === d.getMonth() && m.getFullYear() === d.getFullYear() ? m : new Date(d.getFullYear(), d.getMonth(), 1, 12)));
  }, [value]);

  const days = useMemo(() => monthGrid(month), [month]);
  const from = localDate(days[0]);
  const to = localDate(days[days.length - 1]);
  const ready = !!moduleId && !!venueId;

  useEffect(() => {
    if (!ready) { setAvail(null); return undefined; }
    let current = true;
    setLoading(true);
    api.getDateAvailability({ moduleId, venueId, from, to, ...(excludeBookingId && { excludeBookingId }) })
      .then((r) => { if (current) setAvail({ ...r, days: new Map(r.days.map((d) => [d.date, d.slots])) }); })
      .catch(() => { if (current) setAvail(null); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ready, moduleId, venueId, from, to, excludeBookingId]);

  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  const shown = focus ?? value;
  const shownSlots = shown && avail?.days.get(shown);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button>
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        </span>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label="Choose an exam date">
        {WEEKDAYS.map((w) => <div key={w} role="columnheader" className="pb-1 font-semibold text-muted-foreground">{w}</div>)}
        {days.map((d) => {
          const key = localDate(d);
          const slots = avail?.days.get(key);
          const past = key < today;
          const here = d.getMonth() === month.getMonth();
          const known = ready && slots;
          const ok = known ? slots[slot]?.ok : !past;
          const isSel = key === value;
          const reason = known && !ok ? slots[slot]?.reason : past ? 'In the past' : '';
          return (
            <button
              key={key} type="button" role="gridcell" aria-selected={isSel} disabled={!ok}
              aria-label={`${formatDay(key, { weekday: 'long', day: 'numeric', month: 'long' })}: ${ok ? (known ? `available for the ${slot} session` : 'choose a module and hall to check') : `unavailable, ${reason}`}`}
              title={known ? SLOTS.map((s) => `${s}: ${slots[s].ok ? `available (${slots[s].remaining} seats free)` : slots[s].reason}`).join('\n') : reason || undefined}
              onClick={() => onChange(key)}
              onMouseEnter={() => setFocus(key)} onMouseLeave={() => setFocus(null)}
              style={!ok ? HATCH : undefined}
              className={`relative flex min-h-12 flex-col items-center justify-between rounded-md border px-0.5 py-1 transition-colors
                ${here ? '' : 'opacity-40'}
                ${ok ? (known ? 'border-emerald-300 bg-white hover:bg-emerald-50' : 'border-border bg-white hover:bg-muted') : 'cursor-not-allowed border-transparent text-slate-400'}
                ${isSel ? 'ring-2 ring-primary ring-offset-1' : ''}`}
            >
              <span className={`text-xs ${ok ? 'font-semibold text-foreground' : 'line-through'} ${key === today ? 'underline decoration-2 underline-offset-2' : ''}`}>{d.getDate()}</span>
              {known && (
                <span className="flex gap-0.5" aria-hidden="true">
                  {SLOTS.map((s) => (
                    <span key={s} className={`rounded px-0.5 text-[9px] leading-tight ${slots[s].ok ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-400 line-through'} ${s === slot ? 'ring-1 ring-current/40' : ''}`}>
                      {s.slice(0, 2)}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* legend: identity never by colour alone */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border border-emerald-300 bg-white" /> Available</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded" style={HATCH} /> <span className="line-through">Unavailable</span></span>
        <span><span className="rounded bg-emerald-100 px-0.5 font-semibold text-emerald-800">09</span> <span className="rounded bg-emerald-100 px-0.5 font-semibold text-emerald-800">13</span> = sessions free that day</span>
      </div>

      <div aria-live="polite" className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        {!ready ? 'Choose a module and a hall to see which days are free.'
          : !shown ? `Pick a day. ${avail ? `${avail.needed} students need seats in ${avail.venueName}.` : ''}`
            : !shownSlots ? formatDay(shown, { weekday: 'long', day: 'numeric', month: 'long' })
              : (
                <div className="space-y-0.5">
                  <p className="font-semibold">{formatDay(shown, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  {SLOTS.map((s) => (
                    <p key={s} className={`flex items-center gap-1.5 ${s === slot ? 'font-medium' : 'text-muted-foreground'}`}>
                      {shownSlots[s].ok ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-rose-600" />}
                      {s} session: {shownSlots[s].ok ? `available, ${shownSlots[s].remaining} seats free` : shownSlots[s].reason}
                    </p>
                  ))}
                </div>
              )}
      </div>
    </div>
  );
}
