const CACHE = 'xp-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/index.html')))
  );
});

// Daily notifications via periodic check
// Since Periodic Background Sync has limited support, we use a simpler approach:
// When SW activates, schedule an alarm via setTimeout (works while app is in memory)
// and store last notification time in IndexedDB

function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xp_notif', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('meta');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}

async function getLastNotif() {
  try {
    const db = await getDB();
    return new Promise(resolve => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get('lastNotif');
      req.onsuccess = e => resolve(e.target.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

async function setLastNotif(ts) {
  try {
    const db = await getDB();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(ts, 'lastNotif');
  } catch {}
}

async function maybeNotify() {
  const now = Date.now();
  const last = await getLastNotif();
  const hour = new Date().getHours();
  // Only notify once per day, between 9-10am or 8-9pm
  const isMorning = hour >= 9 && hour < 10;
  const isEvening = hour >= 20 && hour < 21;
  const dayMs = 20 * 60 * 60 * 1000; // 20h gap minimum

  if ((isMorning || isEvening) && (now - last > dayMs)) {
    // Tell client to build the notification (so it can read localStorage)
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length > 0) {
      clients[0].postMessage({ type: 'NOTIFY' });
      await setLastNotif(now);
    } else {
      // App not open — send generic notification
      const title = isMorning ? 'Доброе утро!' : 'Вечерний отчёт';
      const body = isMorning ? 'Открой XP Tracker и заработай очки!' : 'Как прошёл день? Отметь задачи!';
      self.registration.showNotification(title, {
        body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'xp-daily',
        renotify: true,
        data: { url: '/' }
      });
      await setLastNotif(now);
    }
  }
  // Check again in 30 minutes
  setTimeout(maybeNotify, 30 * 60 * 1000);
}

self.addEventListener('activate', () => {
  setTimeout(maybeNotify, 5000);
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});

// Periodic Background Sync (Chrome Android, where supported)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'xp-daily') e.waitUntil(maybeNotify());
});
