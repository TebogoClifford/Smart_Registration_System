import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CalendarPlus, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ExamSittings from '@/components/ExamSittings';
import EditBookingDialog from '@/components/EditBookingDialog';
import { api } from '@/lib/api';
import { localDate, parseDate, addDays, formatDay, hallColour, groupSittings } from '@/lib/exams';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The 6-week grid (Monday first) that shows the month containing `month` (any Date in it).
function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// Month calendar of exam bookings. Pick a day to see its sittings, or book that day.
export default function ExamCalendar() {
  const navigate = useNavigate();
  const today = localDate();
  const [month, setMonth] = useState(() => parseDate(today));
  const [selected, setSelected] = useState(today);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState([]);
  const [editing, setEditing] = useState(null); // booking open in the Edit exam dialog
  const [reload, setReload] = useState(0);

  const days = useMemo(() => monthGrid(month), [month]);
  const from = localDate(days[0]);
  const to = localDate(days[days.length - 1]);

  useEffect(() => { api.getVenues().then(setVenues).catch(() => {}); }, []);

  useEffect(() => {
    // a slow answer for a month the user has already left must not overwrite the current one
    let current = true;
    setLoading(true);
    api.getBookings({ from, to })
      .then((rows) => { if (current) setBookings(rows); })
      .catch((err) => { if (current) toast.error(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [from, to, reload]);

  // after a move, show the exam's new day (and month)
  const moved = (row) => {
    setEditing(null);
    setSelected(row.exam_date);
    const d = parseDate(row.exam_date);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12));
    setReload((n) => n + 1);
  };

  const sittings = useMemo(() => groupSittings(bookings), [bookings]);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const s of sittings) { if (!m.has(s.date)) m.set(s.date, []); m.get(s.date).push(s); }
    return m;
  }, [sittings]);

  const inMonth = (d) => d.getMonth() === month.getMonth();
  const monthSittings = sittings.filter((s) => inMonth(parseDate(s.date)));
  const selectedSittings = byDay.get(selected) ?? [];
  const halls = [...new Map(monthSittings.map((s) => [s.venueId, s.venueName])).entries()];

  const shiftMonth = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  const goToday = () => { setMonth(parseDate(today)); setSelected(today); };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {loading ? 'Loading bookings…' : `${monthSittings.length} hall ${monthSittings.length === 1 ? 'sitting' : 'sittings'} · ${monthSittings.reduce((n, s) => n + s.modules.length, 0)} module exams this month`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft /></Button>
              <Button variant="outline" onClick={goToday}>Today</Button>
              <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight /></Button>
            </div>
          </div>
          {halls.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {halls.map(([id, name]) => <span key={id} className={`rounded border px-2 py-0.5 ${hallColour(id)}`}>{name}</span>)}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 border-l border-t text-xs" role="grid" aria-label="Exam calendar">
            {WEEKDAYS.map((w) => <div key={w} role="columnheader" className="border-b border-r bg-muted/50 px-2 py-1.5 font-semibold text-muted-foreground">{w}</div>)}
            {days.map((d) => {
              const key = localDate(d);
              const list = byDay.get(key) ?? [];
              const isToday = key === today;
              const isSelected = key === selected;
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button
                  key={key} type="button" role="gridcell" aria-selected={isSelected}
                  aria-label={`${formatDay(key, { weekday: 'long', day: 'numeric', month: 'long' })}: ${list.length ? `${list.reduce((n, s) => n + s.modules.length, 0)} exam(s)` : 'no exams'}`}
                  onClick={() => { setSelected(key); if (!inMonth(d)) setMonth(new Date(d.getFullYear(), d.getMonth(), 1, 12)); }}
                  className={`flex min-h-16 flex-col gap-1 border-b border-r p-1 text-left align-top transition-colors hover:bg-muted/60 sm:min-h-24 sm:p-1.5
                    ${inMonth(d) ? (weekend ? 'bg-muted/20' : 'bg-background') : 'bg-muted/40 text-muted-foreground/60'}
                    ${isSelected ? 'ring-2 ring-inset ring-primary' : ''}`}
                >
                  <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>{d.getDate()}</span>
                  {/* phones: one dot per sitting; wider screens: the module codes */}
                  <span className="flex flex-wrap gap-0.5 sm:hidden">{list.map((s) => <span key={s.key} className={`size-2 rounded-full border ${hallColour(s.venueId)}`} />)}</span>
                  <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {list.slice(0, 3).map((s) => (
                      <span key={s.key} title={`${s.slot} · ${s.venueName}: ${s.modules.map((m) => m.code).join(', ')}`} className={`truncate rounded border px-1 py-px text-[11px] leading-tight ${hallColour(s.venueId)}`}>
                        {s.slot} {s.modules.map((m) => m.code).join(', ')}
                      </span>
                    ))}
                    {list.length > 3 && <span className="text-[11px] text-muted-foreground">+{list.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{formatDay(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</CardTitle>
          <p className="text-xs text-muted-foreground">{selectedSittings.length ? `${selectedSittings.reduce((n, s) => n + s.modules.length, 0)} exams in ${selectedSittings.length} hall ${selectedSittings.length === 1 ? 'sitting' : 'sittings'}` : 'No exams booked on this day.'}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedSittings.length > 0
            ? <ExamSittings sittings={selectedSittings} onEdit={(id) => setEditing(bookings.find((b) => b.id === id) ?? null)} />
            : <div className="flex flex-col items-center py-6 text-center text-muted-foreground"><CalendarDays size={26} className="mb-2 opacity-50" /><span className="text-sm">Nothing scheduled.</span></div>}
          <Button className="w-full" onClick={() => navigate(`/bookings?date=${selected}`)}><CalendarPlus /> Book an exam on this day</Button>
        </CardContent>
      </Card>
      {editing && <EditBookingDialog booking={editing} venues={venues} onClose={() => setEditing(null)} onSaved={moved} />}
    </div>
  );
}
