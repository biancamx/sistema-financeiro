import { useEffect, useRef } from 'react';
import { apiUrl } from '../../services/http.js';

/**
 * Botão "Entrar com Google" (Google Identity Services).
 * Só é renderizado quando o backend informa GOOGLE_CLIENT_ID — por enquanto está desativado.
 */
export default function GoogleButton({ clientId, onError }) {
  const box = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      const loginUri = new URL(apiUrl('/auth/google/callback'), window.location.origin).toString();
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'redirect',
        login_uri: loginUri,
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'pt-BR', width: 320 });
    };
    if (window.google?.accounts?.id) init();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = init;
      s.onerror = () => onError?.(new Error('Não foi possível carregar o login do Google'));
      document.head.appendChild(s);
    }
    return () => { cancelled = true; };
  }, [clientId, onError]);
  return <div ref={box} className="google-slot" />;
}
