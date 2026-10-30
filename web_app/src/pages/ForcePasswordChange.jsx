import { KeyRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { useAuth } from '@/lib/auth';

// Shown instead of the console when an administrator created the account or reset the password:
// the temporary password must be replaced before anything else (the server enforces this too).
export default function ForcePasswordChange() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-2 text-center">
          <span className="rounded-md bg-primary/10 p-3 text-primary"><KeyRound size={26} /></span>
          <CardTitle>Choose your own password</CardTitle>
          <p className="text-sm text-muted-foreground">
            Hi {user?.name}. You signed in with a temporary password from an administrator. Choose a new one to continue.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordForm currentLabel="Temporary password" />
          <button type="button" onClick={logout} className="w-full text-center text-xs text-muted-foreground underline">Sign out</button>
        </CardContent>
      </Card>
    </div>
  );
}
