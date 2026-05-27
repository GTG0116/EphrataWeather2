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

    if (url.pathname === "/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target) return json({ ok: false, error: "Missing url parameter" }, 400);
      let targetUrl;
      try { targetUrl = new URL(target); } catch {
        return json({ ok: false, error: "Invalid url" }, 400);
      }
      const allowed = ["nowcoast.noaa.gov", "www.wpc.ncep.noaa.gov", "www.wpc.ncep.noaa.gov"];
      if (!allowed.some(host => targetUrl.hostname === host)) {
        return json({ ok: false, error: "Domain not allowed" }, 403);
      }
      const upstream = await fetch(targetUrl.toString(), {
        headers: { "User-Agent": "WeatherPortal/1.0" },
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
          "Cache-Control": "public, max-age=120",
        },
      });
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
      try {
        const seen = new Set(record.seenAlertIds || []);
        const unseenAlerts = alerts.filter(alert => !seen.has(alert.id));
        const deliveredIds = [];

        for (const alert of unseenAlerts) {
          const result = await sendPush(record.subscription, alert, record.location, env);
          if (result === "gone") {
            await env.SUBSCRIPTIONS.delete(key);
            deliveredIds.length = 0;
            break;
          }
          deliveredIds.push(alert.id);
        }

        if (!deliveredIds.length && unseenAlerts.length && !currentIds.length) {
          continue;
        }

        // Prune stale IDs (expired alerts) and mark all successfully delivered
        // alert IDs as seen so each new alert generates one notification.
        const currentIdSet = new Set(currentIds);
        const updatedSeen = [...seen].filter(id => currentIdSet.has(id));
        deliveredIds.forEach(id => updatedSeen.push(id));
        await env.SUBSCRIPTIONS.put(key, JSON.stringify({
          ...record,
          seenAlertIds: [...new Set(updatedSeen)],
          updatedAt: new Date().toISOString(),
        }));
      } catch (e) {
        console.warn("Push processing failed for subscriber", key, e);
      }
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
    headline: feature.properties?.headline || null,
    expires: feature.properties?.expires || null,
    parameters: feature.properties?.parameters || {},
  })).filter(alert => alert.id);
}

function alertDisplayEvent(alert) {
  const event = alert.event || "Weather Alert";
  const params = alert.parameters || {};
  const floodThreat = String(params.flashFloodDamageThreat?.[0] || "").toLowerCase();
  if (event.toLowerCase() === "flash flood warning" && floodThreat === "catastrophic") {
    return "Flash Flood Emergency";
  }
  return event;
}

async function sendPush(subscription, alert, location, env) {
  const jwt = await vapidJwt(subscription.endpoint, env);

  const eventName = alertDisplayEvent(alert);
  const expiresText = formatExpiration(alert.expires, location);
  const body = expiresText
    ? `${eventName} expires ${expiresText}`
    : alert.headline || `${eventName} issued for your area.`;

  const payload = {
    title: eventName,
    body,
    tag: alert.id,
    id: alert.id,
    event: eventName,
    expires: alert.expires || null,
  };
  const encryptedBody = await encryptPushPayload(subscription, payload);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "TTL": "300",
      "Urgency": "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body: encryptedBody,
  });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) throw new Error(`Push failed: ${response.status}`);
  return "sent";
}

function formatExpiration(expires, location) {
  if (!expires) return "";
  try {
    return new Date(expires).toLocaleTimeString("en-US", {
      timeZone: location?.timezone || "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "";
  }
}

async function encryptPushPayload(subscription, payload) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const p256dhBytes = base64UrlToBytes(subscription.keys.p256dh);
  const authBytes = base64UrlToBytes(subscription.keys.auth);

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw", p256dhBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPublicKey }, serverKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedBits);

  // PRK = HMAC-SHA256(salt=auth, ikm=sharedSecret)
  const prkKey = await crypto.subtle.importKey("raw", authBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, sharedSecret));

  // IKM = HKDF-Expand(PRK, "WebPush: info\0" + subscriber_pub + server_pub, 32)
  const ikm = await hkdfExpand(prk, bytesConcat(
    new TextEncoder().encode("WebPush: info\0"), p256dhBytes, serverPublicRaw
  ), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK2 = HMAC-SHA256(salt=salt, ikm=ikm)
  const prk2Key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk2 = new Uint8Array(await crypto.subtle.sign("HMAC", prk2Key, ikm));

  const cek = await hkdfExpand(prk2, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk2, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, bytesConcat(plaintext, new Uint8Array([2])))
  );

  // aes128gcm record: [16 salt][4 record_size BE][1 keyid_len=65][65 server_pub][ciphertext]
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(serverPublicRaw, 21);
  return bytesConcat(header, ciphertext);
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytesConcat(info, new Uint8Array([1]))));
  return t1.slice(0, length);
}

function bytesConcat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
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
    timezone: location.timezone || null,
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
