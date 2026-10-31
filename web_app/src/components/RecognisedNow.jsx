import { useEffect, useRef, useState } from 'react';
import { ScanFace, UserRound, Armchair, MonitorSmartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

const POLL_MS = 3000;
const FRESH_SECONDS = 60; // a recognition this recent is highlighted as "just now"

const ago = (ts, now) => {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function SeatLine({ r }) {
  if (!r.seat) return <span className="text-slate-500">No exam seat in the {r.session.slot} session</span>;
  if (!r.seat.inThisVenue) return <span className="text-amber-700">Seat {r.seat.number} · {r.seat.moduleCode} is in {r.seat.venueName}</span>;
  return <span className="font-semibold text-emerald-700">Seat {r.seat.number} · {r.seat.moduleCode} {r.seat.moduleName}</span>;
}

// Live list of the students the door devices (e.g. PC-01) recognised, newest first, with the photo
// taken at enrolment. Refreshes every few seconds.
export default function RecognisedNow() {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [photos, setPhotos] = useState({}); // studentId -> object URL
  const asked = useRef(new Set());
  const urls = useRef([]); // every object URL made here, freed when the panel goes away

  useEffect(() => {
    let alive = true;
    const load = () => api.getRecognitions(6)
      .then((rows) => { if (alive) { setList(rows); setFailed(false); setNow(Date.now()); } })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const t = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  // the photo of the newest recognition (each student's photo is fetched once)
  const latest = list?.[0];
  useEffect(() => {
    const s = latest?.student;
    if (!s?.hasPhoto || asked.current.has(s.id)) return;
    asked.current.add(s.id);
    api.getStudentPhotoUrl(s.id).then((url) => { urls.current.push(url); setPhotos((p) => ({ ...p, [s.id]: url })); }).catch(() => {});
  }, [latest]);
  useEffect(() => {
    const made = urls.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const fresh = latest && (now - new Date(latest.timestamp).getTime()) / 1000 < FRESH_SECONDS;

  return (
    <Card className="rounded-lg border-slate-200/80 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-bold text-slate-900">Recognised now</CardTitle>
          <p className="mt-1 text-xs text-slate-500">Students recognised at the door devices · updates every few seconds</p>
        </div>
        <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><ScanFace size={18} /></span>
      </CardHeader>
      <CardContent>
        {failed && !list ? <p className="text-sm text-rose-700">Recognitions could not be loaded.</p>
          : !list ? <div className="h-28 animate-pulse rounded-md bg-slate-100" />
            : list.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center text-slate-500">
                <ScanFace size={26} className="mb-2 opacity-50" />
                <p className="text-sm font-medium text-slate-700">Nobody recognised yet</p>
                <p className="mt-1 max-w-xs text-xs">Press "Start recognition" on the PC-01 program; recognised students appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div aria-live="polite" className={`flex gap-4 rounded-lg border p-4 ${fresh ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="size-24 shrink-0 overflow-hidden rounded-md bg-slate-200">
                    {photos[latest.student.id]
                      ? <img src={photos[latest.student.id]} alt={`Enrolment photo of ${latest.student.name}`} className="size-full object-cover" />
                      : <div className="flex size-full items-center justify-center text-slate-400"><UserRound size={36} /></div>}
                  </div>
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold text-slate-900">{latest.student.name}</span>
                      {fresh && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">just now</span>}
                    </p>
                    <p className="font-mono text-xs text-slate-600">{latest.student.studentNumber}</p>
                    <p className="text-slate-600">{latest.student.course || 'Course not set'}</p>
                    <p className="flex items-center gap-1.5"><Armchair size={14} className="shrink-0 text-slate-400" /><SeatLine r={latest} /></p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500"><MonitorSmartphone size={13} className="shrink-0" />{latest.device.name} · {latest.venue.name} · {ago(latest.timestamp, now)}</p>
                  </div>
                </div>
                {list.length > 1 && (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {list.slice(1).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                        <span className="min-w-0"><span className="font-medium text-slate-800">{r.student.name}</span> <span className="font-mono text-xs text-slate-500">{r.student.studentNumber}</span></span>
                        <span className="text-xs text-slate-500">{r.seat ? `Seat ${r.seat.number} · ${r.seat.moduleCode}` : 'No seat'} · {r.device.name} · {ago(r.timestamp, now)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
      </CardContent>
    </Card>
  );
}
