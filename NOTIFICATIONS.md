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
