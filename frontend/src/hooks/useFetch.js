import { useCallback, useEffect, useRef, useState } from 'react';
import { getFetchData, setFetchData } from '../services/fetchDataCache.js';

/** Busca dados quando as dependências mudam. Retorna { data, loading, error, reload, setData }. */
export function useFetch(fn, deps = [], { enabled = true, cacheKey: explicitCacheKey, refreshEvent } = {}) {
  const cacheKey = explicitCacheKey || `${fn.toString()}::${JSON.stringify(deps)}`;
  const [state, setState] = useState(() => {
    const data = enabled ? getFetchData(cacheKey) : undefined;
    return { data: data ?? null, loading: enabled && data === undefined, error: null };
  });
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (silent = false) => {
    const id = ++run.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === run.current) {
        setFetchData(cacheKey, data);
        setState({ data, loading: false, error: null });
      }
    } catch (error) {
      if (id === run.current) setState((s) => ({ data: silent ? s.data : null, loading: false, error }));
    }
  }, [cacheKey]);

  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (enabled) load();
    else setState({ data: null, loading: false, error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    if (!refreshEvent) return undefined;
    window.addEventListener(refreshEvent, reload);
    return () => window.removeEventListener(refreshEvent, reload);
  }, [refreshEvent, reload]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload, setData };
}
