import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, LOGOUT_EVENT } from '@/lib/api';
import { AuthContext } from '@/lib/auth';

// Asks the server whether sign-in is switched on. If it is, restores the session from the saved token.
// If it is not (server has no JWT_SECRET yet), the console works as before, as an administrator.
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
  useEffect(() => {
    window.addEventListener(LOGOUT_EVENT, logout);
    return () => window.removeEventListener(LOGOUT_EVENT, logout);
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.login(email, password);
    setToken(token);
    setUser(u);
  }, []);

  const value = useMemo(() => ({
    ready, authRequired, startupError, retry: boot, login, logout,
    user: authRequired ? user : { name: 'Administrator', email: '', role: 'admin' },
    signedIn: !authRequired || !!user,
    isAdmin: !authRequired || user?.role === 'admin',
  }), [ready, authRequired, startupError, boot, login, logout, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
