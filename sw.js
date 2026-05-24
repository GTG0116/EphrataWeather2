const CACHE_NAME = "weather-portal-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./icons.js",
  "./manifest.json",
  "./favicon-32.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match("./index.html")))
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }

  const alertId = payload.tag || payload.id;
  const title = payload.title || "Weather Alert";
  const options = {
    body: payload.body || "A new weather alert has been issued.",
    tag: alertId || "weather-alert",
    renotify: true,
    badge: "./icon-192.png",
    icon: "./icon-192.png",
    data: { url: payload.url || "./index.html" }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      alertId ? markAlertShown(alertId) : Promise.resolve(),
      alertId ? broadcastToClients({ type: "push-alert-shown", id: alertId }) : Promise.resolve(),
    ])
  );
});

async function markAlertShown(id) {
  const cache = await caches.open("push-shown-alerts-v1");
  const existing = await cache.match("ids").then(r => r?.json()).catch(() => null) || [];
  if (!existing.includes(id)) {
    existing.push(id);
    await cache.put("ids", new Response(JSON.stringify(existing), { headers: { "Content-Type": "application/json" } }));
  }
}

async function broadcastToClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach(c => c.postMessage(message));
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const fromNotifUrl = new URL("./index.html", self.location.origin);
  fromNotifUrl.searchParams.set("from", "notification");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => new URL(c.url).origin === self.location.origin);
      if (appClient) {
        appClient.postMessage({ type: "notification-click" });
        return appClient.focus();
      }
      return self.clients.openWindow(fromNotifUrl.href);
    })
  );
});
