import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDraft, clearDrafts } from '@/lib/drafts';

// Lets an invigilator record a manual entry override for a denied/error event.
// When sign-in is on, the server uses the signed-in account, so the name box is hidden.
export default function OverrideDialog({ event, onClose: close, onDone }) {
  const { authRequired, user } = useAuth();
  // what you typed is kept if you visit another page and come back; Cancel or saving drops it
  const k = `override:${event.id}:`;
  const [who, setWho] = useDraft(`${k}who`, '');
  const [reason, setReason] = useDraft(`${k}reason`, '');
  const onClose = () => { clearDrafts(k); close(); };
  const [saving, setSaving] = useState(false);
  const invigilator = authRequired ? user?.email : who.trim();
  const ok = !!invigilator && reason.trim().length >= 3 && !saving;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.overrideEvent(event.id, invigilator, reason.trim());
      toast.success(`Entry override recorded for event ${event.id}`);
      clearDrafts(k);
      onDone();
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Override entry">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-lg border bg-background p-6 shadow-lg">
        <div>
          <h3 className="text-lg font-bold">Override entry</h3>
          <p className="text-sm text-muted-foreground">
            Event {event.id} was {String(event.decision).toLowerCase()}. Recording an override lets the student in manually and is kept in the audit trail.
          </p>
        </div>
        {authRequired ? (
          <p className="text-sm">Recorded as <strong>{user?.email}</strong></p>
        ) : (
          <div className="space-y-1">
            <label htmlFor="ov-who" className="text-sm font-medium">Invigilator name or email</label>
            <Input id="ov-who" value={who} onChange={(e) => setWho(e.target.value)} maxLength={255} />
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="ov-reason" className="text-sm font-medium">Reason</label>
          <Input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Verified student card" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!ok}>Record override</Button>
        </div>
      </form>
    </div>
  );
}
