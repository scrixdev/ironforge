// ═══════════════════════════════════════════════════════
//  IRONFORGE — Service Worker v6
//  Network-first pour HTML + Cache offline + Push Notifications
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'ironforge-v6';
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
  const url = new URL(event.request.url);
  const isHTML = event.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');

  if (isHTML) {
    // HTML → réseau EN PRIORITÉ, cache seulement si offline
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(r => r || caches.match('/ironforge/index.html'))
      )
    );
  } else {
    // Images, fonts, CSS → cache en priorité
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => null);
      })
    );
  }
});

// ── PUSH (vrai push serveur via GitHub Actions + VAPID) ──────
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
  const targetUrl = '/ironforge/?start=1';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/ironforge')) {
          client.postMessage({ type: 'OPEN_SESSION' });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGES ─────────────────────────────────────────────────
const scheduledTimers = new Map();

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'OPEN_SESSION') {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'OPEN_SESSION' }));
    });
    return;
  }

  // Notif programmée — un seul timer par tag, jamais de doublon
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, tag, fireAt } = event.data;
    const delay = Math.max(0, fireAt - Date.now());

    // Annule l'ancien timer si même tag (ex: page rechargée)
    if (scheduledTimers.has(tag)) {
      clearTimeout(scheduledTimers.get(tag));
    }

    const id = setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/ironforge/icon-192.png',
        badge: '/ironforge/icon-192.png',
        tag,
        vibrate: [200, 100, 200],
        requireInteraction: false,
        data: { url: '/ironforge/?start=1' },
        actions: [
          { action: 'open', title: '🏋️ Lancer la séance' },
          { action: 'dismiss', title: '✕ Ignorer' }
        ]
      });
      scheduledTimers.delete(tag);
    }, delay);

    scheduledTimers.set(tag, id);
  }
});
