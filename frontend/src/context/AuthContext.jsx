import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../services/api.js';
import {
  setAccountPendingHandler,
  setReauthRequiredHandler,
  setUnauthorizedHandler,
} from '../services/http.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const accountRefresh = useRef(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    setReauthRequiredHandler(async () => {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (returnTo !== '/login') window.sessionStorage.setItem('auth:returnTo', returnTo);
      window.sessionStorage.setItem('auth:reauthRequired', '1');
      await authApi.logout().catch(() => {});
      setUser(null);
    });
    setAccountPendingHandler(() => {
      if (!accountRefresh.current) {
        accountRefresh.current = authApi.me()
          .then((r) => setUser(r?.user || r?.data?.user))
          .catch(() => setUser(null))
          .finally(() => { accountRefresh.current = null; });
      }
      return accountRefresh.current;
    });
    const boot = async () => {
      if (import.meta.env.DEV) {
        try {
          const response = await authApi.local();
          setUser(response?.user || response?.data?.user);
          return;
        } catch {
          // Falls back to the regular session check if local demo login is unavailable.
        }
      }
      try {
        const response = await authApi.me();
        setUser(response?.user || response?.data?.user);
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    };
    boot().finally(() => setBooting(false));
  }, []);

  const finish = useCallback(async (promise) => {
    const r = await promise;
    const u = r?.user || r?.data?.user;
    setUser(u);
    return u;
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      loginLocal: () => finish(authApi.local()),
      login: (b) => finish(authApi.login(b)),
      register: (b) => finish(authApi.register(b)),
      loginGoogle: (credential) => finish(authApi.google(credential)),
      logout: async () => {
        await authApi.logout().catch(() => {});
        setUser(null);
      },
    }),
    [user, booting, finish],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
