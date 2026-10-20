import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api.js';
import { setUnauthorizedHandler } from '../services/http.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    authApi.me().then((r) => setUser(r?.user || r?.data?.user)).catch(() => setUser(null)).finally(() => setBooting(false));
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
