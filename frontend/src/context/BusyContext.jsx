import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../components/ui/ui.jsx';

const BusyContext = createContext(null);
export const useAppBusy = () => useContext(BusyContext);

export function BusyProvider({ children }) {
  const [message, setMessage] = useState(null);
  const overlayRef = useRef(null);
  const begin = useCallback((nextMessage) => setMessage(nextMessage), []);
  const end = useCallback(() => setMessage(null), []);
  const value = useMemo(() => ({ message, begin, end }), [message, begin, end]);

  useEffect(() => {
    if (message) overlayRef.current?.focus();
  }, [message]);

  return (
    <BusyContext.Provider value={value}>
      {children}
      {message && (
        <div ref={overlayRef} className="app-busy-overlay" role="alertdialog" aria-modal="true" aria-labelledby="app-busy-title" aria-describedby="app-busy-description" tabIndex={-1}>
          <section className="app-busy-dialog">
            <div className="app-busy-spinner" aria-hidden="true" />
            <h2 id="app-busy-title">{message}</h2>
            <p id="app-busy-description">Aguarde até a conclusão para continuar usando o sistema.</p>
            <Spinner label="Processando com segurança…" />
          </section>
        </div>
      )}
    </BusyContext.Provider>
  );
}
