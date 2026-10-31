import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Mail, RefreshCcw, ShieldAlert, FlaskConical, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useDraft } from '@/lib/drafts';

const REFRESH_MS = 10000;
const KIND = { booked: 'Exam booked', moved: 'Exam moved', cancelled: 'Exam cancelled' };
const STATUS = {
  sent: { label: 'Sent', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  queued: { label: 'Sending…', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  failed: { label: 'Failed', className: 'border-rose-200 bg-rose-50 text-rose-800' },
  skipped: { label: 'Not sent (test mode)', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  logged: { label: 'Recorded only', className: 'border-slate-200 bg-slate-50 text-slate-700' },
};
const FILTERS = [{ value: 'all', label: 'All emails' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))];

// What the email set-up means, in plain words.
function ModeBanner({ info }) {
  if (!info) return null;
  if (info.mode === 'live') {
    return <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><Send size={16} className="mt-0.5 shrink-0" />Live: every student gets their exam emails (from {info.from}).</p>;
  }
  if (info.mode === 'test') {
    return <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><FlaskConical size={16} className="mt-0.5 shrink-0" />
      <span>Test mode: only {info.testTo.length ? info.testTo.join(', ') : 'nobody (EMAIL_TEST_TO is empty)'} really receive{info.testTo.length === 1 ? 's' : ''} email; the other students' emails are recorded here but not sent. Set EMAIL_MODE=live on the server to email everyone.</span></p>;
  }
  return <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"><ShieldAlert size={16} className="mt-0.5 shrink-0" />
    <span>Email sending is not set up yet, so exam emails are recorded here but not sent. Add BREVO_API_KEY and EMAIL_FROM on the server to start (test mode first).</span></p>;
}

// Exam > Email log: every email to a student about an exam, and what happened to it.
export default function EmailLog() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useDraft('emails:filter', 'all');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.getEmails({ limit: 200, ...(filter !== 'all' && { status: filter }) })); }
    catch (err) { toast.error(err.message); }
  }, [filter]);
  useEffect(() => {
    load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const retry = async () => {
    setBusy(true);
    try { const r = await api.retryEmails(); toast.success(`${r.requeued} failed email(s) are being sent again`); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const counts = data?.counts ?? {};
  return (
    <div className="space-y-4">
      <ModeBanner info={data} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Mail size={18} /> Email log</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Emails to students when an exam is booked, moved or cancelled · refreshes every 10 seconds</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={setFilter} items={FILTERS}>
              <SelectTrigger aria-label="Show" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load}><RefreshCcw /> Refresh</Button>
            {counts.failed > 0 && <Button size="sm" onClick={retry} disabled={busy}><Send /> Send failed again ({counts.failed})</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(STATUS).map(([k, s]) => (counts[k] ? <span key={k} className={`rounded-full border px-2 py-0.5 ${s.className}`}>{s.label}: <b>{counts[k]}</b></span> : null))}
          </div>
          {!data ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            : data.emails.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No emails yet. Booking, moving or cancelling an exam emails its students.</p>
              : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Student</TableHead><TableHead>About</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.emails.map((e) => (
                        <Fragment key={e.id}>
                          <TableRow className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
                            <TableCell><span className="font-medium">{e.to_name}</span><span className="block text-xs text-muted-foreground">{e.to_email || 'no email address'}</span></TableCell>
                            <TableCell className="max-w-md"><span className="text-xs text-muted-foreground">{KIND[e.kind] ?? e.kind}</span><span className="block truncate text-sm">{e.subject}</span></TableCell>
                            <TableCell>
                              <Badge variant="outline" className={STATUS[e.status]?.className}>{STATUS[e.status]?.label ?? e.status}</Badge>
                              {e.error && e.status === 'failed' && <span className="block max-w-56 truncate text-xs text-rose-700" title={e.error}>{e.error}</span>}
                            </TableCell>
                          </TableRow>
                          {open === e.id && (
                            <TableRow>
                              <TableCell colSpan={4} className="bg-muted/30">
                                <p className="mb-1 text-xs text-muted-foreground">To {e.to_name} &lt;{e.to_email}&gt;{e.sent_at ? ` · sent ${new Date(e.sent_at).toLocaleString()}` : ''}{e.error ? ` · ${e.error}` : ''}</p>
                                <p className="mb-2 text-sm font-semibold">{e.subject}</p>
                                <pre className="whitespace-pre-wrap font-sans text-sm">{e.body_text}</pre>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
        </CardContent>
      </Card>
    </div>
  );
}
