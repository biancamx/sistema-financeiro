import { useCallback, useEffect, useRef, useState } from 'react';

/** Busca dados quando as dependências mudam. Retorna { data, loading, error, reload, setData }. */
export function useFetch(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (silent = false) => {
    const id = ++run.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === run.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (id === run.current) setState((s) => ({ data: silent ? s.data : null, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
    else setState({ data: null, loading: false, error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: () => load(true), setData };
}
