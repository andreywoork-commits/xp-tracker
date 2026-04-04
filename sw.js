const CACHE = 'xp-v3';
const BASE = '/xp-tracker';
const ASSETS = [BASE + '/', BASE + '/index.html', BASE + '/manifest.json'];

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
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match(BASE + '/index.html')))
  );
});

function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xp_notif', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('meta');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}
async function getVal(key) {
  try { const db = await getDB(); return new Promise(res => { const r = db.transaction('meta','readonly').objectStore('meta').get(key); r.onsuccess = e => res(e.target.result); r.onerror = () => res(null); }); } catch { return null; }
}
async function setVal(key, val) {
  try { const db = await getDB(); const tx = db.transaction('meta','readwrite'); tx.objectStore('meta').put(val, key); } catch {}
}

async function maybeNotify() {
  const now = Date.now();
  const last = await getVal('lastNotif') || 0;
  const hour = new Date().getHours();
  const isMorning = hour >= 9 && hour < 10;
  const isEvening = hour >= 20 && hour < 21;
  const dayMs = 20 * 60 * 60 * 1000;
  if ((isMorning || isEvening) && (now - last > dayMs)) {
    const allClients = await self.clients.matchAll({ type: 'window' });
    if (allClients.length > 0) {
      allClients[0].postMessage({ type: 'NOTIFY', hour });
      await setVal('lastNotif', now);
    } else {
      const title = isMorning ? 'Доброе утро!' : 'Вечерний отчёт';
      const body = isMorning ? 'Заработай XP сегодня!' : 'Проверь дневной прогресс';
      self.registration.showNotification(title, {
        body, icon: BASE + '/icon-192.png', badge: BASE + '/icon-192.png',
        tag: 'xp-daily', renotify: true
      });
      await setVal('lastNotif', now);
    }
  }
  setTimeout(maybeNotify, 30 * 60 * 1000);
}

self.addEventListener('activate', () => { setTimeout(maybeNotify, 5000); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(BASE + '/'));
});

self.addEventListener('periodicsync', e => {
  if (e.tag === 'xp-daily') e.waitUntil(maybeNotify());
});
