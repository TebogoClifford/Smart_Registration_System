import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const ROLES = [{ value: 'invigilator', label: 'Invigilator' }, { value: 'admin', label: 'Administrator' }];

// Administrators create invigilator accounts here; invigilators then sign in with them.
export default function Users() {
  const { user: me, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'invigilator' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setUsers(await api.getUsers()); } catch (err) { toast.error(err.message); }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return <p className="py-10 text-center text-muted-foreground">Only an administrator can manage accounts.</p>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createUser(form);
      toast.success(`Account created for ${form.email}`);
      setForm({ name: '', email: '', password: '', role: 'invigilator' });
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };
  const remove = async (id) => {
    try { await api.deleteUser(id); toast.success('Account deleted'); load(); } catch (err) { toast.error(err.message); }
  };
  const resetPassword = async (u) => {
    const password = window.prompt(`New password for ${u.email} (8+ characters):`);
    if (!password) return;
    try { await api.updateUser(u.id, { password }); toast.success('Password changed'); } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Add an account</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
            <Input placeholder="Full name" value={form.name} onChange={set('name')} aria-label="Full name" />
            <Input placeholder="Email" type="email" value={form.email} onChange={set('email')} aria-label="Email" />
            <Input placeholder="Password (8+ characters)" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} aria-label="Password" />
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))} items={ROLES}>
              <SelectTrigger aria-label="Role" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="submit" disabled={saving || !form.name || !form.email || !form.password}>Create account</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Accounts ({users.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}{me?.id === u.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role === 'admin' ? 'Administrator' : 'Invigilator'}</Badge></TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => resetPassword(u)}>Reset password</Button>
                    {me?.id !== u.id && <ConfirmDeleteDialog itemName={u.email} onConfirm={() => remove(u.id)} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
