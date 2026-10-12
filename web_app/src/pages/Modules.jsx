import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog';
import { api } from '@/lib/api';

// Modules (subjects). Students are enrolled in modules here; an exam booking later seats everyone enrolled.
export default function Modules() {
  const [modules, setModules] = useState([]);
  const [students, setStudents] = useState([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);          // module whose student list is open
  const [selected, setSelected] = useState(new Set());
  const [original, setOriginal] = useState(new Set());
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api.getModules(), api.getStudents()]);
      setModules(m); setStudents(s);
    } catch (err) { toast.error(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createModule(code, name);
      toast.success('Module created');
      setCode(''); setName('');
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    try { await api.deleteModule(id); toast.success('Module deleted'); if (open?.id === id) setOpen(null); load(); } catch (err) { toast.error(err.message); }
  };

  const openStudents = async (m) => {
    try {
      const enrolled = await api.getModuleStudents(m.id);
      const ids = new Set(enrolled.map((s) => s.id));
      setOpen(m); setSelected(new Set(ids)); setOriginal(ids); setFilter('');
    } catch (err) { toast.error(err.message); }
  };

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Add first (it can be refused when a booked hall is full), then remove.
  const saveStudents = async () => {
    const add = [...selected].filter((id) => !original.has(id));
    const drop = [...original].filter((id) => !selected.has(id));
    setSaving(true);
    try {
      if (add.length) await api.addModuleStudents(open.id, add);
      for (const id of drop) await api.removeModuleStudent(open.id, id);
      toast.success('Enrolments saved');
      setOpen(null);
      load();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return students.filter((s) => !q || `${s.student_number} ${s.name} ${s.course_name ?? ''}`.toLowerCase().includes(q));
  }, [students, filter]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Add a module</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row">
            <Input placeholder="Code, e.g. PRG101" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Module code" className="sm:max-w-48" />
            <Input placeholder="Module name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Module name" />
            <Button type="submit" disabled={saving || !code.trim() || !name.trim()}>Add module</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Modules ({modules.length})</CardTitle></CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No modules yet. Add one above, then enrol students in it.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Students</TableHead><TableHead>Exam bookings</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {modules.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.code}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.student_count}</TableCell>
                    <TableCell>{m.booking_count}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => openStudents(m)}>Students</Button>
                      <ConfirmDeleteDialog itemName={`module ${m.code}`} onConfirm={() => remove(m.id)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-label={`Students in ${open.code}`} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-background p-5 shadow-lg">
            <h3 className="text-lg font-bold">{open.code} — {open.name}</h3>
            <p className="mb-3 text-sm text-muted-foreground">Tick the students taking this module. If it is already booked, new students get a seat automatically.</p>
            <Input placeholder="Search students…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search students" />
            <div className="my-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No students match.</p>}
              {shown.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-mono text-xs">{s.student_number}</span>
                  <span className="text-sm">{s.name}</span>
                  {s.course_name && <span className="ml-auto text-xs text-muted-foreground">{s.course_name}</span>}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
                <Button onClick={saveStudents} disabled={saving}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
