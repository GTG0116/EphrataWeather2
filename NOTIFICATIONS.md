# Weather Alert Notifications

This app now supports:

- installable standalone mode through `manifest.json`
- a service worker for app-shell caching and notification clicks
- foreground alert notifications while the app is open and permission is enabled
- Web Push handling in `sw.js` for notifications when the installed web app is closed

What GitHub Pages can do by itself:

- host the PWA files over HTTPS
- let iOS install it to the Home Screen
- request notification permission from the installed web app
- receive Web Push notifications if an outside sender sends them

What GitHub Pages cannot do by itself:

- continuously poll NWS/IEM while nobody has the web app open
- store push subscriptions securely
- send push messages on a schedule

To get closed-app notifications working, add one of these outside pieces:

1. A small backend or serverless function that stores each user's Web Push subscription.
2. A scheduled job, such as GitHub Actions cron, Cloudflare Workers Cron, Vercel Cron, or a small VPS script.
3. The job checks `https://api.weather.gov/alerts/active?point=LAT,LON` or the IEM storm-based warnings feed.
4. When it finds a new alert id, it sends a Web Push payload to saved subscriptions using VAPID keys.

In `app.js`, fill these after you have that outside service:

```js
const PUSH_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY";
const PUSH_SUBSCRIBE_ENDPOINT = "https://your-service.example.com/subscribe";
```

The subscribe endpoint should accept JSON containing `subscription` and `location`, store it, and use that subscription when your scheduled alert checker sends Web Push messages.

The matching `/unsubscribe` endpoint accepts JSON containing the subscription `endpoint` and deletes the stored record. The Alerts button in the top bar toggles: while notifications are enabled it shows "Alerts On" with a green indicator, and clicking it again unsubscribes the device and stops both push and in-app notifications.

For iPhone/iPad, the user must install the site to the Home Screen first, open it from that icon, then tap the Alerts button and allow notifications. Normal Safari tabs cannot receive Web Push the same way an installed web app can.

## iOS push troubleshooting (investigated June 2026)

Findings from debugging "iOS Home Screen app never receives pushes":

1. **Broken service worker install (root cause found and fixed).**
   `sw.js` listed `icon-192.png` and `icon-512.png` in its app-shell precache
   list, but those files were never committed — `manifest.json` referenced
   them too. `cache.addAll()` rejects the whole install when any asset 404s,
   so on devices that first installed the app after those entries were added
   (e.g. a freshly added iOS Home Screen app), the service worker **never
   finished installing**. No service worker means no `pushManager`
   subscription and no `push` event handler, so notifications silently never
   arrived. Devices that had installed an older SW version (desktop Chrome,
   typically) kept working from the previously activated worker, which is why
   the failure looked iOS-only. Fixes:
   - `icon-192.png` / `icon-512.png` are now real files in the repo.
   - The install handler caches assets individually (`Promise.allSettled`)
     so one missing file can never block installation again.
   - `CACHE_NAME` bumped to `weather-portal-v3` to force a clean reinstall.

2. **Recovery steps on an affected iPhone.** Delete the Home Screen app,
   reopen the site in Safari, re-add it to the Home Screen, open it from the
   icon, and tap **Alerts** again. iOS ties the push subscription to the Home
   Screen install; re-adding creates a fresh subscription that the worker
   stores via `/subscribe`.

3. **iOS beta caveat.** On iOS developer betas (the report came from iOS 27
   beta on an iPhone 16), Apple's push environment occasionally invalidates
   existing web-push subscriptions across major upgrades. The app already
   re-subscribes on every launch (`registerPushSubscription()` runs at
   startup when notifications are enabled) and force-replaces subscriptions
   whose VAPID key no longer matches, so a single app launch after the OS
   update is enough to repair the registration. If pushes still fail on a
   beta build, verify in Settings → Notifications that the web app is listed
   and allowed, and test delivery end-to-end with the worker's
   `/check-now` endpoint.

4. **Things that were checked and are correct:** VAPID JWT audience/expiry,
   `aes128gcm` payload encryption, `TTL`/`Urgency` headers, `userVisibleOnly`
   subscription, and the `push` handler calling `showNotification()` inside
   `event.waitUntil()` before any secondary work (an iOS requirement).
