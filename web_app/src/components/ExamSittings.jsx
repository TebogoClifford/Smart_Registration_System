import { Clock, MapPin } from 'lucide-react';
import { hallColour } from '@/lib/exams';

// A list of exam sittings (hall + session) with the modules in each and how full the hall is.
export default function ExamSittings({ sittings, showDate = false, formatDate, className = 'space-y-3' }) {
  return (
    <ul className={className}>
      {sittings.map((s) => {
        const pct = s.capacity > 0 ? Math.min(100, Math.round((s.reserved / s.capacity) * 100)) : 0;
        const full = s.capacity > 0 && s.reserved >= s.capacity;
        return (
          <li key={s.key} className={`rounded-md border p-3 ${hallColour(s.venueId)}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold"><MapPin size={14} className="shrink-0" /><span className="truncate">{s.venueName}</span></span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium"><Clock size={13} />{showDate && formatDate ? `${formatDate(s.date)} · ` : ''}{s.slot}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.modules.map((m) => (
                <span key={m.id} title={m.name} className="rounded border border-current/15 bg-white/70 px-1.5 py-0.5 text-xs">
                  <span className="font-mono font-semibold">{m.code}</span> <span className="opacity-75">{m.seats} seats</span>
                </span>
              ))}
            </div>
            <div className="mt-2.5">
              <div className="mb-1 flex justify-between text-[11px]">
                <span>{s.reserved} of {s.capacity} seats used</span>
                <span className="font-semibold">{full ? 'Full' : `${Math.max(0, s.capacity - s.reserved)} free`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-current opacity-60" style={{ width: `${pct}%` }} /></div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
