// ═══════════════════════════════════════════════════════
//  IRONFORGE — Service Worker v7
//  Network-first pour HTML + Cache offline + Push Notifications
//  + Persistance IndexedDB pour survivre aux redémarrages SW
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'ironforge-v7';
const ASSETS = [
  '/ironforge/',
  '/ironforge/index.html',
  '/ironforge/manifest.json',
  '/ironforge/icon-192.png',
  '/ironforge/icon-512.png'
];

// ── INDEXEDDB : persistance des notifs programmées ──────────
// Le SW peut être tué à tout moment par le navigateur.
// On stocke chaque notification programmée dans IDB.
// À chaque réveil (install / activate / message), on restaure les timers.

const DB_NAME    = 'ironforge-sw';
const DB_VERSION = 1;
const STORE_NAME = 'scheduled';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'tag' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbSave(item) {
  return openDB().then(db => {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  });
}

function dbDelete(tag) {
  return openDB().then(db => {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(tag);
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  });
}

function dbGetAll() {
  return openDB().then(db => {
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  });
}

// ── TIMERS EN MÉMOIRE ─────────────────────────────────────────
const scheduledTimers = new Map();

function fireNotification(title, body, tag, notifData = {}) {
  const data = Object.assign({ url: '/ironforge/?start=1' }, notifData);
  return self.registration.showNotification(title, {
    body,
    icon:               '/ironforge/icon-192.png',
    badge:              '/ironforge/icon-192.png',
    tag,
    vibrate:            [200, 100, 200],
    requireInteraction: false,
    data,
    actions: [
      { action: 'open',    title: '🏋️ Lancer la séance' },
      { action: 'dismiss', title: '✕ Ignorer' }
    ]
  });
}

// Programme (ou reprogramme) un timer en mémoire + persiste dans IDB
function scheduleTimer(item) {
  const { tag, title, body, fireAt, notifData } = item;
  const delay = fireAt - Date.now();

  // Passée de plus de 2 min → nettoyage IDB, on ne déclenche pas
  if (delay < -2 * 60 * 1000) {
    dbDelete(tag);
    return;
  }

  // Moins de 10 min dans le futur au moment de la CRÉATION → on ignore
  // (évite les déclenchements immédiats lors d'une nouvelle programmation)
  // MAIS si c'est une restauration IDB (SW redémarré), on accepte tout ce qui n'est pas passé
  const isRestore = item._isRestore === true;
  if (!isRestore && delay < 10 * 60 * 1000 && delay > 0) {
    return; // trop proche, ignoré
  }

  const clampedDelay = Math.max(0, delay);

  // Annule l'ancien timer si même tag
  if (scheduledTimers.has(tag)) clearTimeout(scheduledTimers.get(tag));

  const id = setTimeout(() => {
    fireNotification(title, body, tag, notifData || {});
    scheduledTimers.delete(tag);
    dbDelete(tag);
  }, clampedDelay);

  scheduledTimers.set(tag, id);
}

// Restaure tous les timers depuis IDB (appelé au réveil du SW)
async function restoreScheduledTimers() {
  try {
    const items = await dbGetAll();
    for (const item of items) {
      scheduleTimer({ ...item, _isRestore: true }); // marque comme restauration IDB
    }
    if (items.length > 0) {
      console.log(`[IRONFORGE SW] ${items.length} timer(s) restauré(s) depuis IDB`);
    }
  } catch(e) {
    console.log('[IRONFORGE SW] Erreur restauration IDB:', e);
  }
}

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => restoreScheduledTimers())
  );
  self.skipWaiting();
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => restoreScheduledTimers())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url   = new URL(event.request.url);
  const isHTML = event.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');

  if (isHTML) {
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

// ── PUSH (vrai push serveur VAPID via GitHub Actions) ─────────
self.addEventListener('push', event => {
  let data = {
    title: '⚡ IRONFORGE',
    body:  "Il est l'heure de t'entraîner !",
    tag:   'ironforge-push',
    data:  { url: '/ironforge/' }
  };
  if (event.data) {
    try { Object.assign(data, event.data.json()); }
    catch(e) { data.body = event.data.text() || data.body; }
  }
  event.waitUntil(fireNotification(data.title, data.body, data.tag));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const notifData  = event.notification.data || {};
  const progKey    = notifData.progKey || '';
  const dayKey     = notifData.dayKey  || '';
  const params     = new URLSearchParams({ start: '1' });
  if (progKey) params.set('prog', progKey);
  if (dayKey)  params.set('day',  dayKey);
  const targetUrl  = '/ironforge/?' + params.toString();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/ironforge')) {
          // Page déjà ouverte — envoie les infos de séance
          client.postMessage({ type: 'OPEN_SESSION', progKey, dayKey });
          return client.focus();
        }
      }
      // Page fermée — ouvre avec les paramètres URL
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGES (depuis index.html) ──────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'OPEN_SESSION') {
    self.clients.matchAll({ type: 'window' }).then(cs => {
      cs.forEach(c => c.postMessage({ type: 'OPEN_SESSION' }));
    });
    return;
  }

  // Notif programmée — persistée dans IDB + timer en mémoire
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, tag, fireAt, data: notifData } = event.data;

    const item = { tag, title, body, fireAt, notifData: notifData || {} };

    // Persiste dans IDB AVANT de programmer le timer (survit aux redémarrages SW)
    // _isRestore: false → le guard 10 min s'applique (notif créée maintenant)
    dbSave(item)
      .then(() => scheduleTimer({ ...item, _isRestore: false }))
      .catch(() => scheduleTimer({ ...item, _isRestore: false }));
  }

  // Annulation explicite d'une notif programmée (ex: séance supprimée)
  if (event.data?.type === 'CANCEL_NOTIFICATION') {
    const { tag } = event.data;
    if (scheduledTimers.has(tag)) {
      clearTimeout(scheduledTimers.get(tag));
      scheduledTimers.delete(tag);
    }
    dbDelete(tag);
  }
});
