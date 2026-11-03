import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const lastToastAt = useRef(0);
  const push = useCallback((message, tone = 'ok') => {
    lastToastAt.current = Date.now();
    const id = crypto.randomUUID();
    setItems((l) => [...l, { id, message, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  useEffect(() => {
    const showMutationToast = (event) => {
      const request = event.detail;
      window.setTimeout(() => {
        if (Date.now() - lastToastAt.current < 120) return;
        const message = request.method === 'DELETE'
          ? 'Registro excluído com sucesso.'
          : request.method === 'POST'
            ? 'Ação concluída e registrada com sucesso.'
            : 'Alterações salvas com sucesso.';
        push(message);
      }, 120);
    };
    window.addEventListener('app:mutation-success', showMutationToast);
    return () => window.removeEventListener('app:mutation-success', showMutationToast);
  }, [push]);
  const value = useMemo(() => ({ success: (m) => push(m, 'ok'), error: (e) => push(e?.message || String(e), 'error') }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
