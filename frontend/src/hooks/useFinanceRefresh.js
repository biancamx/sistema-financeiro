import { useEffect, useRef } from 'react';

export function notifyFinanceChanged() {
  window.dispatchEvent(new Event('finance:refresh'));
}

export function useFinanceRefresh(reload) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const refresh = () => reloadRef.current();
    window.addEventListener('finance:refresh', refresh);
    return () => window.removeEventListener('finance:refresh', refresh);
  }, []);
}
