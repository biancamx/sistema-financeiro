import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/global.css';
import App from './app/App.jsx';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  console.warn('Nova versão detectada no servidor. Recarregando...');
  window.location.reload();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .catch((error) => console.error('Não foi possível registrar o service worker de notificações:', error));
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
