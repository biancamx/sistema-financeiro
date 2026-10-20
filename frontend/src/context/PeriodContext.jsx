import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PeriodContext = createContext(null);
export const usePeriod = () => useContext(PeriodContext);
const KEY = 'financeiro:period';

function initial() {
  const now = new Date();
  const fallback = { month: now.getMonth() + 1, year: now.getFullYear() };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.month >= 1 && saved?.month <= 12 && saved?.year > 2000) return saved;
  } catch { /* sem storage */ }
  return fallback;
}

/** Mês/ano escolhidos no topo: valem para dashboard, lançamentos e cartões (igual aos seletores da planilha). */
export function PeriodProvider({ children }) {
  const [period, setPeriod] = useState(initial);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(period)); } catch { /* ignore */ }
  }, [period]);
  const value = useMemo(
    () => ({
      ...period,
      setMonth: (month) => setPeriod((p) => ({ ...p, month })),
      setYear: (year) => setPeriod((p) => ({ ...p, year })),
      shift: (delta) =>
        setPeriod((p) => {
          const idx = p.year * 12 + (p.month - 1) + delta;
          return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
        }),
    }),
    [period],
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}
