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

## Updating the deployed Cloudflare Worker

This repository already has the live Worker configuration in `wrangler.toml`:

- Worker: `weather-alert-worker`
- public URL: `https://weather-alert-worker.gtg0116scratch.workers.dev`
- code entry point: `cloudflare-alert-worker.js`
- KV binding: `SUBSCRIPTIONS` (the existing namespace stores every device)
- schedule: every two minutes
- encrypted secret required at runtime: `VAPID_PRIVATE_KEY`

For an ordinary code update, **do not** create a new Worker, KV namespace, or
VAPID key. The existing subscriptions and KV data remain in place when the
Worker code is deployed.

### Normal update from Windows PowerShell

1. Open PowerShell in the repository and confirm Node/npm are available:

   ```powershell
   Set-Location D:\EphrataWeather2
   node --version
   npm.cmd --version
   npx.cmd wrangler@latest --version
   ```

   The first `npx.cmd` run may ask permission to download Wrangler. Cloudflare
   recommends a current Wrangler release; using `@latest` here does not require
   adding it permanently to this older project.

2. Sign in, then verify which Cloudflare account Wrangler will use:

   ```powershell
   npx.cmd wrangler@latest login
   npx.cmd wrangler@latest whoami
   ```

   The login command opens a browser. If more than one Cloudflare account is
   offered, choose the account that owns the `gtg0116scratch.workers.dev`
   subdomain and the existing `weather-alert-worker` Worker.

3. Confirm the live Worker and its private-key secret already exist:

   ```powershell
   npx.cmd wrangler@latest deployments list
   npx.cmd wrangler@latest secret list
   ```

   The first command should show existing deployments. The second should list
   `VAPID_PRIVATE_KEY` (it shows the name, never the secret value). If no
   existing Worker/deployments appear, stop: Wrangler is almost certainly using
   the wrong Cloudflare account. If the secret name is missing, see **Missing
   private key** below before deploying.

4. Run the repository tests and a non-live Worker build:

   ```powershell
   npm.cmd test
   npx.cmd wrangler@latest deploy --dry-run
   ```

5. Deploy the Worker:

   ```powershell
   npx.cmd wrangler@latest deploy
   ```

   Wrangler reads `wrangler.toml`, uploads `cloudflare-alert-worker.js`, keeps
   the encrypted secret, reuses the configured KV namespace, and applies the
   two-minute Cron Trigger. Confirm that the printed target is exactly:

   ```text
   https://weather-alert-worker.gtg0116scratch.workers.dev
   ```

6. Verify the deployment without sending a notification:

   ```powershell
   Invoke-RestMethod "https://weather-alert-worker.gtg0116scratch.workers.dev/health"
   npx.cmd wrangler@latest deployments list
   ```

   The health response should contain `ok: true` and
   `service: weather-alert-worker`.

7. To watch the next scheduled run, leave this open for at least two minutes:

   ```powershell
   npx.cmd wrangler@latest tail
   ```

   Press Ctrl+C when finished. The following optional endpoint runs the alert
   check immediately, but it is **not** a read-only health check: it can send
   real pushes to every stored subscriber and update their seen-alert state.
   Use it only when an immediate production notification test is intentional:

   ```powershell
   Invoke-RestMethod "https://weather-alert-worker.gtg0116scratch.workers.dev/check-now"
   ```

### Missing private key

A normal deployment preserves `VAPID_PRIVATE_KEY`; it does not need to be
entered again. If `secret list` does not show it and the original private key
is available, restore it without putting it in any repository file:

```powershell
npx.cmd wrangler@latest secret put VAPID_PRIVATE_KEY
```

Paste the original value only into Wrangler's prompt. If that value has been
lost, stop rather than generating a replacement casually: the public/private
VAPID pair must match, and rotating it also requires updating the public key in
both `wrangler.toml` and `app.js` so installed devices can resubscribe.

### Roll back a bad Worker deployment

List the deployments, copy the last known-good version ID, and roll back to it:

```powershell
npx.cmd wrangler@latest deployments list
npx.cmd wrangler@latest rollback <VERSION_ID>
```

Rollback changes the live Worker immediately. It does not alter the local
files, so fix or revert the local code separately before the next deployment.

### Worker deployment versus website deployment

`npx.cmd wrangler deploy` updates only the Cloudflare notification/proxy Worker.
Changes to `app.js`, `sw.js`, `index.html`, or other website files still reach
GitHub Pages through the repository's normal Git push/deployment. When a change
touches both sides, deploy the Worker first, verify `/health`, and then publish
the website so the server side is ready before browsers receive the new client.

Current Cloudflare references: [install/update Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/),
[deploy command](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
and [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/).
