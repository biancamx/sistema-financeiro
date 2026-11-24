import { useEffect, useRef } from 'react';
import { apiUrl } from '../../services/http.js';

/**
 * Botão "Entrar com Google" (Google Identity Services).
 * Só é renderizado quando o backend informa GOOGLE_CLIENT_ID.
 */
export default function GoogleButton({ clientId, onError }) {
  const box = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let renderedWidth = 0;
    const renderButton = () => {
      if (cancelled || !window.google?.accounts?.id || !box.current) return;
      const availableWidth = Math.floor(box.current.getBoundingClientRect().width);
      if (!availableWidth || availableWidth === renderedWidth) return;
      renderedWidth = availableWidth;
      box.current.replaceChildren();
      window.google.accounts.id.renderButton(box.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'pt-BR',
        width: Math.min(400, availableWidth),
      });
    };
    const init = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      const loginUri = new URL(apiUrl('/auth/google/callback'), window.location.origin).toString();
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'redirect',
        login_uri: loginUri,
      });
      renderButton();
    };
    const observer = new ResizeObserver(renderButton);
    if (box.current) observer.observe(box.current);
    if (window.google?.accounts?.id) init();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = init;
      s.onerror = () => onError?.(new Error('Não foi possível carregar o login do Google'));
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [clientId, onError]);
  return <div ref={box} className="google-slot" />;
}
