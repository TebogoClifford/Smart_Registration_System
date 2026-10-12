import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { ShieldCheck, Loader2 } from 'lucide-react';

// Only for the demo build: one click fills in the seeded demo accounts (see Backend/tools/seed-demo.js).
const DEMO = import.meta.env.VITE_DEMO === 'true';
const DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@demo.local', password: 'Admin#2026' },
  { label: 'Invigilator', email: 'nomsa@demo.local', password: 'Invigilator#2026' },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-2 text-center">
          <span className="rounded-md bg-primary/10 p-3 text-primary"><ShieldCheck size={26} /></span>
          <CardTitle>SRS Console</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in with your invigilator account.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />} Sign in
            </Button>
            <p className="text-center text-xs text-muted-foreground">Accounts are created by an administrator.</p>
          </form>
          {DEMO && (
            <div className="mt-4 space-y-2 rounded-md border border-dashed p-3 text-xs" data-testid="demo-accounts">
              <p className="font-semibold">Demo accounts (build with VITE_DEMO=true)</p>
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} type="button" className="block w-full rounded border px-2 py-1 text-left hover:bg-muted"
                  onClick={() => { setEmail(a.email); setPassword(a.password); }}>
                  {a.label} · {a.email}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
