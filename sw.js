// Bump on every release. The name is the cache's identity, so changing it is
// what makes activate() drop the previous release's copies of the app shell —
// otherwise a visitor who goes offline is served the old code indefinitely.
const CACHE_NAME = "weather-portal-v21";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./js/on-device-weather.js",
  "./js/bzip2.js",
  "./js/level2.js",
  "./js/decoder.worker.js",
  "./js/s3.js",
  "./js/products.js",
  "./js/radarLayer.js",
  "./js/dealias.js",
  "./js/mrms.js",
  "./js/nowcast.js",
  "./js/nowcast.worker.js",
  "./js/grib2.js",
  "./js/gridLayer.js",
  "./js/jpx.js",
  "./js/hdf5.js",
  "./js/mirs.js",
  "./js/goes.js",
  "./js/satProducts.js",
  "./js/satellite.worker.js",
  "./js/satClient.js",
  "./js/satelliteLayer.js",
  "./icons.js",
  "./manifest.json",
  "./favicon-32.png",
  "./favicon-64.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  // Cache each shell asset independently. cache.addAll() rejects the whole
  // install when ANY asset 404s — icon-192/512.png were missing from the
  // deploy for a while, which silently failed install on fresh devices and
  // with it every push notification (no service worker, no push). One bad
  // asset must never take down installation.
  //
  // cache: "reload" makes each request skip the browser's HTTP cache. Without
  // it the precache is filled from whatever the CDN told the browser to hold on
  // to earlier, so a service worker built for this release could quietly stock
  // itself with the previous one's app.js and styles.css.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        APP_SHELL.map(asset => cache.add(new Request(asset, { cache: "reload" })))
      ))
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
  // Network first, cache only as the offline fallback. ignoreSearch matters
  // because index.html requests its scripts with a ?v= release stamp while the
  // precache holds the bare paths — without it an offline load would miss,
  // fall through to the index.html fallback, and hand the page HTML where it
  // asked for JavaScript.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request, { ignoreSearch: true })
        .then(response => response || caches.match("./index.html"))
    )
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
  const scope = self.registration.scope;
  const options = {
    body: payload.body || "A new weather alert has been issued.",
    tag: alertId || "weather-alert",
    badge: new URL("./icon-192.png", scope).href,
    icon: new URL("./icon-192.png", scope).href,
    data: { url: payload.url || scope }
  };

  // Show the notification first, then handle secondary tasks independently so
  // failures in caching or client broadcast don't prevent the notification on iOS.
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if (alertId) {
      await markAlertShown(alertId).catch(() => {});
      await broadcastToClients({ type: "push-alert-shown", id: alertId }).catch(() => {});
    }
  })());
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
  const fromNotifUrl = new URL("./index.html", self.location.href);
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
