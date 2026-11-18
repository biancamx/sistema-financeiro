self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = payload.title || 'Caderno de Contas';
  const options = {
    body: payload.body || 'Você tem uma nova notificação financeira.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/painel' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let targetUrl;
  try {
    targetUrl = new URL(event.notification.data?.url || '/painel', self.location.origin);
    if (targetUrl.origin !== self.location.origin) targetUrl = new URL('/painel', self.location.origin);
  } catch {
    targetUrl = new URL('/painel', self.location.origin);
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if (client.url !== targetUrl.href) await client.navigate(targetUrl.href);
      return client.focus();
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});
