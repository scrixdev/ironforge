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

// ── MESSAGES (SKIP_WAITING + SCHEDULE_NOTIFICATION) ─────────
// Map pour stocker les timers programmés et éviter les doublons
const scheduledNotifs = new Map();

self.addEventListener('message', event => {

  // Mise à jour forcée du SW
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // ── Notif programmée depuis l'app (quand app ouverte/arrière-plan) ──
  // Fonctionne sur Android Chrome PWA installée
  // Sur iOS Safari : préférer le push VAPID via GitHub Actions
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, delay, fireAt, tag } = event.data;

    // Si un timer existe déjà pour ce tag, on l'annule d'abord
    if (scheduledNotifs.has(tag)) {
      clearTimeout(scheduledNotifs.get(tag));
      scheduledNotifs.delete(tag);
    }

    // Recalcule le délai réel depuis fireAt pour éviter
    // les dérives si le SW a été suspendu puis réveillé
    const realDelay = fireAt ? Math.max(0, fireAt - Date.now()) : delay;

    if (realDelay <= 0) return; // heure déjà passée, on skip

    const timerId = setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/ironforge/icon-192.png',
        badge: '/ironforge/icon-192.png',
        tag: tag || 'ironforge-' + Date.now(),
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: false,
        data: { url: '/ironforge/' },
        actions: [
          { action: 'open', title: '🏋️ Lancer la séance' },
          { action: 'dismiss', title: '✕ Ignorer' }
        ]
      });
      scheduledNotifs.delete(tag);
    }, realDelay);

    scheduledNotifs.set(tag, timerId);
  }
});
