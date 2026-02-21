// ═══════════════════════════════════════════════════════
//  IRONFORGE — Service Worker v4
//  Cache offline + Vraies Push Notifications (VAPID)
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'ironforge-v4';
const ASSETS = [
  '/ironforge/',
  '/ironforge/index.html',
  '/ironforge/manifest.json',
  '/ironforge/icon-192.png',
  '/ironforge/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('/ironforge/index.html');
        }
      });
    })
  );
});

// ── PUSH : reçoit les notifs depuis GitHub Actions ───────
self.addEventListener('push', event => {
  let data = {
    title: '⚡ IRONFORGE',
    body: "Il est l'heure de t'entraîner !",
    icon: '/ironforge/icon-192.png',
    badge: '/ironforge/icon-192.png',
    tag: 'ironforge-push',
    data: { url: '/ironforge/' }
  };

  if (event.data) {
    try { Object.assign(data, event.data.json()); }
    catch(e) { data.body = event.data.text() || data.body; }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/ironforge/icon-192.png',
      badge: data.badge || '/ironforge/icon-192.png',
      tag: data.tag || 'ironforge-' + Date.now(),
      vibrate: [200, 100, 200, 100, 200],
      data: data.data || { url: '/ironforge/' },
      requireInteraction: false,
      actions: [
        { action: 'open', title: '🏋️ Lancer la séance' },
        { action: 'dismiss', title: '✕ Ignorer' }
      ]
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const targetUrl = event.notification.data?.url || '/ironforge/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/ironforge') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
