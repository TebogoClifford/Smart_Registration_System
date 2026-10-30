import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, LOGOUT_EVENT, PASSWORD_CHANGE_EVENT } from '@/lib/api';
import { AuthContext } from '@/lib/auth';

// Asks the server whether sign-in is switched on. If it is, restores the session from the saved token.
// If it is not (server run with AUTH_DISABLED=true for tests), the console works as an administrator.
export default function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [startupError, setStartupError] = useState('');

  const boot = useCallback(async () => {
    setStartupError('');
    try {
      const { authRequired: required } = await api.getAuthStatus();
      setAuthRequired(required);
      if (required && getToken()) {
        try { setUser(await api.me()); } catch { setToken(null); setUser(null); }
      }
      setReady(true);
    } catch {
      setStartupError('Cannot reach the server. It may be waking up (this can take up to 30 seconds).');
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  // re-read who I am (e.g. after a password reset or a profile change)
  const refreshUser = useCallback(async () => {
    try { setUser(await api.me()); } catch { /* a 401 already signs out via LOGOUT_EVENT */ }
  }, []);
  useEffect(() => {
    window.addEventListener(LOGOUT_EVENT, logout);
    window.addEventListener(PASSWORD_CHANGE_EVENT, refreshUser);
    return () => {
      window.removeEventListener(LOGOUT_EVENT, logout);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, refreshUser);
    };
  }, [logout, refreshUser]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.login(email, password);
    setToken(token);
    setUser(u);
  }, []);

  const value = useMemo(() => ({
    ready, authRequired, startupError, retry: boot, login, logout, refreshUser, setUser,
    user: authRequired ? user : { name: 'Administrator', email: '', role: 'admin' },
    signedIn: !authRequired || !!user,
    isAdmin: !authRequired || user?.role === 'admin',
    mustChangePassword: authRequired && !!user?.must_change_password,
  }), [ready, authRequired, startupError, boot, login, logout, refreshUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
