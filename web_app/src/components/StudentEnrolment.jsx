import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ScanFace, UserRound, Loader2, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const REQUEST_TTL_MS = 10 * 60 * 1000; // the server ignores capture requests older than this (ENROLL_REQUEST_TTL_SECONDS)
const POLL_MS = 3000;
const TONE = { enrolled: 'default', pending: 'secondary', failed: 'destructive' };
const LABEL = { enrolled: 'Enrolled', pending: 'Pending', failed: 'Failed' };

// True while a capture request is waiting for the device to answer.
const isWaiting = (student, now = Date.now()) => student.enrollment_status === 'pending'
  && !!student.enrollment_requested_at && now - new Date(student.enrollment_requested_at).getTime() < REQUEST_TTL_MS;

// The student's face enrolment: status, photo, device and an explanation (the Enrol face button
// sits with the page's other actions, see EnrolFaceButton).
export default function StudentEnrolment({ student, device }) {
  const [photo, setPhoto] = useState(null);
  const photoUrl = useRef(null);
  const status = student.enrollment_status;
  const waiting = isWaiting(student);
  const requestedAt = student.enrollment_requested_at ? new Date(student.enrollment_requested_at) : null;

  // the enrolment photo (needs the sign-in header, so it is fetched as a blob)
  useEffect(() => {
    let alive = true;
    if (!student.has_image) { setPhoto(null); return undefined; }
    api.getStudentPhotoUrl(student.id).then((url) => {
      if (!alive) { URL.revokeObjectURL(url); return; }
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      photoUrl.current = url;
      setPhoto(url);
    }).catch(() => {});
    return () => { alive = false; };
  }, [student.id, student.has_image, status]);
  useEffect(() => () => { if (photoUrl.current) URL.revokeObjectURL(photoUrl.current); }, []);

  const online = device?.status === 'active';
  const explain = waiting
    ? `Waiting for ${device?.name ?? 'the device'} to capture the face. The student should stand in front of its camera now.`
    : status === 'enrolled' ? `The face is stored on ${device?.name ?? 'the device'}; the student can be recognised.`
      : status === 'failed' ? 'The last capture did not finish (no face found in time, or it was skipped). Press Enrol face to try again.'
        : 'Registered, but the face has not been captured yet. Press Enrol face (below) while the student is at the device.';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2"><ScanFace size={18} /> Face enrolment</CardTitle>
        <Badge variant={TONE[status] ?? 'secondary'} className="text-xs">{waiting ? 'Capturing…' : LABEL[status] ?? status}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        <div className="size-28 shrink-0 overflow-hidden rounded-md bg-muted">
          {photo
            ? <img src={photo} alt={`Enrolment photo of ${student.name}`} className="size-full object-cover" />
            : <div className="flex size-full items-center justify-center text-muted-foreground"><UserRound size={40} /></div>}
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <p aria-live="polite" className="flex items-start gap-2">
            {waiting && <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-primary" />}
            <span>{explain}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {online ? <Wifi size={13} className="text-emerald-600" /> : <WifiOff size={13} className="text-rose-600" />}
              {device ? `${device.name} is ${online ? 'online' : 'offline'}` : 'No device assigned'}
            </span>
            {requestedAt && <span>Last capture request: {requestedAt.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </p>
          {device && !online && <p className="text-xs text-amber-700">Start the {device.name} program first; a request is only picked up within 10 minutes.</p>}
          {status === 'enrolled' && <p className="text-xs text-muted-foreground">Re-enrolling replaces the stored face and photo with a new capture.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// "Enrol face" / "Re-enrol face": asks the student's device (e.g. PC-01) to capture them, then
// follows the status every few seconds until the device reports enrolled or failed.
export function EnrolFaceButton({ student, device, onStudentChange }) {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0); // re-check the 10-minute window while waiting
  const waiting = isWaiting(student);

  useEffect(() => {
    if (!waiting) return undefined;
    const t = window.setInterval(() => {
      setTick((n) => n + 1);
      api.getStudent(student.id).then((s) => {
        if (s.enrollment_status !== 'pending') {
          toast[s.enrollment_status === 'enrolled' ? 'success' : 'error'](
            s.enrollment_status === 'enrolled' ? `${s.name}'s face is enrolled on ${device?.name ?? 'the device'}` : `Capture failed for ${s.name}. Try Enrol face again.`);
        }
        onStudentChange(s);
      }).catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [waiting, student.id, device?.name, onStudentChange]);

  const enrol = async () => {
    setBusy(true);
    try {
      onStudentChange(await api.reEnrollStudent(student.id));
      toast.success(`Capture requested: ${student.name} should now look at ${device?.name ?? 'the device'}'s camera`);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Button type="button" variant="outline" onClick={enrol} disabled={busy || waiting || !device}>
      {busy || waiting ? <Loader2 className="animate-spin" /> : <ScanFace />}
      {waiting ? 'Capturing…' : student.enrollment_status === 'enrolled' ? 'Re-enrol face' : 'Enrol face'}
    </Button>
  );
}
