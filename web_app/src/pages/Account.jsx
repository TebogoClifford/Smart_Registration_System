import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const when = (t) => (t ? new Date(t).toLocaleString() : '—');

// My account: anyone signed in can see their details, change their name and phone, and their password.
// Email, role and staff number are set by an administrator on the Accounts page.
export default function Account() {
  const { user, setUser, authRequired } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm({ name: user?.name ?? '', phone: user?.phone ?? '' }); }, [user]);

  if (!authRequired) return <p className="py-10 text-center text-muted-foreground">Sign-in is switched off on this server, so there is no account to manage.</p>;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setUser(await api.updateMe({ name: form.name, phone: form.phone }));
      toast.success('Details saved');
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };
  const changed = form.name.trim() !== (user?.name ?? '') || form.phone.trim() !== (user?.phone ?? '');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>My details</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Email (sign-in)</dt><dd className="font-medium">{user?.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd><Badge variant={user?.role === 'admin' ? 'default' : 'secondary'}>{user?.role === 'admin' ? 'Administrator' : 'Invigilator'}</Badge></dd>
            <dt className="text-muted-foreground">Staff number</dt><dd>{user?.staff_number || '—'}</dd>
            <dt className="text-muted-foreground">Last sign-in</dt><dd>{when(user?.last_login_at)}</dd>
          </dl>
          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="me-name" className="text-sm font-medium">Full name</label>
              <Input id="me-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="me-phone" className="text-sm font-medium">Phone</label>
              <Input id="me-phone" type="tel" placeholder="e.g. +27 82 555 0101" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <Button type="submit" disabled={saving || !changed || !form.name.trim()}>Save details</Button>
          </form>
          <p className="text-xs text-muted-foreground">To change your email, role or staff number, ask an administrator.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
        <CardContent><ChangePasswordForm /></CardContent>
      </Card>
    </div>
  );
}
