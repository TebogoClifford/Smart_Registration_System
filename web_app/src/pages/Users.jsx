import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, X } from 'lucide-react';
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
const EMPTY = { name: '', email: '', staff_number: '', phone: '', role: 'invigilator', password: '', mustChangePassword: true };
const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

function Field({ id, label, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// Administrators create and look after accounts here. Every account signs in with its email;
// a password set or generated here is temporary and must be replaced at the first sign-in.
export default function Users() {
  const { user: me, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);      // the account being edited (copy of its fields)
  const [issued, setIssued] = useState(null);        // { email, password } shown once
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setUsers(await api.getUsers()); } catch (err) { toast.error(err.message); }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return <p className="py-10 text-center text-muted-foreground">Only an administrator can manage accounts.</p>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setE = (k) => (e) => setEditing((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form };
      if (!body.password) delete body.password;   // the server generates one
      const created = await api.createUser(body);
      toast.success(`Account created for ${created.email}`);
      setIssued({ email: created.email, password: created.temporaryPassword ?? form.password, mustChange: created.must_change_password });
      setForm(EMPTY);
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { id, name, email, staff_number, phone, role } = editing;
      await api.updateUser(id, { name, email, staff_number, phone, role });
      toast.success('Account updated');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const resetPassword = async (u) => {
    if (!window.confirm(`Give ${u.email} a new temporary password? Their current password stops working.`)) return;
    try {
      const r = await api.resetUserPassword(u.id);
      setIssued({ email: r.email, password: r.temporaryPassword, mustChange: true });
      load();
    } catch (err) { toast.error(err.message); }
  };
  const setActive = async (u, active) => {
    try { await api.updateUser(u.id, { active }); toast.success(active ? 'Account enabled' : 'Account disabled'); load(); } catch (err) { toast.error(err.message); }
  };
  const remove = async (id) => {
    try { await api.deleteUser(id); toast.success('Account deleted'); load(); } catch (err) { toast.error(err.message); }
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Copy failed: select the text and copy it'); }
  };

  return (
    <div className="space-y-6">
      {issued && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
            <KeyRound className="shrink-0 text-emerald-700" size={22} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">Password for {issued.email}</p>
              <p className="mt-1 font-mono text-base tracking-wide" data-testid="issued-password">{issued.password}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Give this to the person now: it is not shown again.{issued.mustChange ? ' They must choose their own password when they first sign in.' : ''}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => copy(issued.password)}><Copy size={14} /> Copy</Button>
            <Button variant="ghost" size="sm" aria-label="Hide password" onClick={() => setIssued(null)}><X size={16} /></Button>
          </CardContent>
        </Card>
      )}

      {editing ? (
        <Card>
          <CardHeader><CardTitle>Edit {editing.email}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={saveEdit} className="grid gap-3 md:grid-cols-3">
              <Field id="e-name" label="Full name"><Input id="e-name" value={editing.name} onChange={setE('name')} /></Field>
              <Field id="e-email" label="Email (sign-in)"><Input id="e-email" type="email" value={editing.email} onChange={setE('email')} /></Field>
              <Field id="e-role" label="Role">
                <Select value={editing.role} onValueChange={(v) => setEditing((f) => ({ ...f, role: v }))} items={ROLES}>
                  <SelectTrigger id="e-role" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="e-staff" label="Staff number (optional)"><Input id="e-staff" value={editing.staff_number} onChange={setE('staff_number')} /></Field>
              <Field id="e-phone" label="Phone (optional)"><Input id="e-phone" type="tel" value={editing.phone} onChange={setE('phone')} /></Field>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={saving || !editing.name.trim() || !editing.email.trim()}>Save</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Add an account</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
              <Field id="n-name" label="Full name"><Input id="n-name" value={form.name} onChange={set('name')} /></Field>
              <Field id="n-email" label="Email (used to sign in)"><Input id="n-email" type="email" value={form.email} onChange={set('email')} /></Field>
              <Field id="n-role" label="Role">
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))} items={ROLES}>
                  <SelectTrigger id="n-role" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="n-staff" label="Staff number (optional)"><Input id="n-staff" value={form.staff_number} onChange={set('staff_number')} /></Field>
              <Field id="n-phone" label="Phone (optional)"><Input id="n-phone" type="tel" placeholder="+27 82 555 0101" value={form.phone} onChange={set('phone')} /></Field>
              <Field id="n-pw" label="Password (leave empty to generate one)">
                <Input id="n-pw" type="password" autoComplete="new-password" placeholder="8+ characters" value={form.password} onChange={set('password')} />
              </Field>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={form.mustChangePassword} onChange={(e) => setForm((f) => ({ ...f, mustChangePassword: e.target.checked }))} />
                They must choose their own password at the first sign-in (recommended)
              </label>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={saving || !form.name.trim() || !form.email.trim() || (form.password && form.password.length < 8)}>Create account</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Accounts ({users.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
                <TableHead>Staff no.</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.active ? '' : 'opacity-60'}>
                  <TableCell className="font-medium">{u.name}{me?.id === u.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role === 'admin' ? 'Administrator' : 'Invigilator'}</Badge></TableCell>
                  <TableCell>{u.staff_number || '—'}</TableCell>
                  <TableCell>{u.phone || '—'}</TableCell>
                  <TableCell className="space-x-1">
                    {u.active ? <Badge variant="outline" className="border-emerald-300 text-emerald-700">Active</Badge> : <Badge variant="outline">Disabled</Badge>}
                    {u.must_change_password && <Badge variant="outline" className="border-amber-300 text-amber-700">Temporary password</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{when(u.last_login_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="inline-flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditing({ ...u, staff_number: u.staff_number ?? '', phone: u.phone ?? '' })}>Edit</Button>
                      <Button variant="outline" size="sm" onClick={() => resetPassword(u)}>Reset password</Button>
                      {me?.id !== u.id && (u.active
                        ? <Button variant="outline" size="sm" onClick={() => setActive(u, false)}>Disable</Button>
                        : <Button variant="outline" size="sm" onClick={() => setActive(u, true)}>Enable</Button>)}
                      {me?.id !== u.id && <ConfirmDeleteDialog itemName={u.email} onConfirm={() => remove(u.id)} />}
                    </div>
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
