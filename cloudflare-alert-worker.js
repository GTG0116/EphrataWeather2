const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "weather-alert-worker" });
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      const body = await request.json();
      const subscription = body.subscription;
      const location = normalizeLocation(body.location);
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return json({ ok: false, error: "Missing Web Push subscription" }, 400);
      }
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
        return json({ ok: false, error: "Missing location" }, 400);
      }

      const key = await subscriptionKey(subscription.endpoint);
      const alerts = await activeAlerts(location, env);
      await env.SUBSCRIPTIONS.put(key, JSON.stringify({
        subscription,
        location,
        seenAlertIds: alerts.map(alert => alert.id),
        updatedAt: new Date().toISOString(),
      }));

      return json({ ok: true, key, seen: alerts.length });
    }

    if (url.pathname === "/check-now") {
      await checkSubscriptions(env);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkSubscriptions(env));
  },
};

async function checkSubscriptions(env) {
  let cursor;
  const grouped = new Map();

  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: "sub:", cursor });
    cursor = page.cursor;
    for (const item of page.keys) {
      const record = await env.SUBSCRIPTIONS.get(item.name, "json");
      if (!record?.subscription?.endpoint || !record.location) continue;
      const groupKey = `${roundCoord(record.location.lat)},${roundCoord(record.location.lon)}`;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey).push({ key: item.name, record });
    }
  } while (cursor);

  for (const subscribers of grouped.values()) {
    const location = subscribers[0].record.location;
    const alerts = await activeAlerts(location, env).catch(() => []);
    const currentIds = alerts.map(alert => alert.id);

    for (const { key, record } of subscribers) {
      const seen = new Set(record.seenAlertIds || []);
      const newest = alerts.find(alert => !seen.has(alert.id));
      if (newest) {
        const result = await sendPush(record.subscription, env);
        if (result === "gone") {
          await env.SUBSCRIPTIONS.delete(key);
          continue;
        }
      }
      await env.SUBSCRIPTIONS.put(key, JSON.stringify({
        ...record,
        seenAlertIds: currentIds,
        updatedAt: new Date().toISOString(),
      }));
    }
  }
}

async function activeAlerts(location, env) {
  const endpoint = `https://api.weather.gov/alerts/active?point=${location.lat},${location.lon}`;
  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/geo+json, application/json",
      "User-Agent": env.NWS_USER_AGENT || "WeatherPortal/1.0 weather-alert-worker",
    },
  });
  if (!response.ok) throw new Error(`NWS alerts failed: ${response.status}`);
  const data = await response.json();
  return (data.features || []).map(feature => ({
    id: feature.id || feature.properties?.id || `${feature.properties?.event}-${feature.properties?.sent}`,
    event: feature.properties?.event || "Weather Alert",
  })).filter(alert => alert.id);
}

async function sendPush(subscription, env) {
  const jwt = await vapidJwt(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "TTL": "300",
      "Urgency": "high",
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) throw new Error(`Push failed: ${response.status}`);
  return "sent";
}

async function vapidJwt(pushEndpoint, env) {
  const aud = new URL(pushEndpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlJson({
    aud,
    exp,
    sub: env.VAPID_SUBJECT || "mailto:weather@example.com",
  });
  const signingInput = `${header}.${payload}`;
  const key = await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

async function importVapidKey(publicKey, privateKey) {
  const pub = base64UrlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be uncompressed P-256");
  const d = base64UrlToBytes(privateKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlBytes(pub.slice(1, 33)),
    y: base64UrlBytes(pub.slice(33, 65)),
    d: base64UrlBytes(d),
    ext: false,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function subscriptionKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return `sub:${base64UrlBytes(new Uint8Array(digest))}`;
}

function normalizeLocation(location = {}) {
  return {
    lat: Number(location.lat),
    lon: Number(location.lon),
    name: String(location.name || "Saved location"),
  };
}

function roundCoord(value) {
  return Number(value).toFixed(3);
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function base64UrlBytes(bytes) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
