import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Used on My account and on the forced screen after an administrator set a temporary password.
export default function ChangePasswordForm({ currentLabel = 'Current password', onDone }) {
  const { setUser } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const problem = f.next && f.next.length < 8 ? 'At least 8 characters.'
    : f.again && f.next !== f.again ? 'The two new passwords do not match.'
      : f.next && f.next === f.current ? 'Choose a password different from the current one.' : '';

  const submit = async (e) => {
    e.preventDefault();
    if (problem || !f.current || !f.next || !f.again) return;
    setBusy(true);
    try {
      const { user } = await api.changePassword(f.current, f.next);
      if (user) setUser(user);
      toast.success('Password changed');
      setF({ current: '', next: '', again: '' });
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="pw-current" className="text-sm font-medium">{currentLabel}</label>
        <Input id="pw-current" type="password" autoComplete="current-password" value={f.current} onChange={set('current')} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pw-next" className="text-sm font-medium">New password</label>
        <Input id="pw-next" type="password" autoComplete="new-password" value={f.next} onChange={set('next')} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pw-again" className="text-sm font-medium">New password again</label>
        <Input id="pw-again" type="password" autoComplete="new-password" value={f.again} onChange={set('again')} />
      </div>
      {problem && <p className="text-sm text-amber-700">{problem}</p>}
      <Button type="submit" className="gap-2" disabled={busy || !!problem || !f.current || !f.next || !f.again}>
        {busy && <Loader2 size={15} className="animate-spin" />} Change password
      </Button>
    </form>
  );
}
