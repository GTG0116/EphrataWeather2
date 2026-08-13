// Live GOES-19 Geostationary Lightning Mapper (GLM) flashes.
//
// NOAA publishes each 20-second GLM-L2-LCFA file in its public, CORS-enabled
// GOES-19 S3 bucket.  The files already contain geolocated flash centroids, so
// the map can render true satellite-observed lightning as transparent points
// without baking it into an opaque satellite/radar image.

import { HDF5File } from './hdf5.js';

export const GLM_BUCKET = 'https://noaa-goes19.s3.amazonaws.com';
export const GLM_PRODUCT = 'GLM-L2-LCFA';
export const GLM_WINDOW_MINUTES = 5;

const pad = (value, width = 2) => String(value).padStart(width, '0');

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
  ) - start) / 86400000);
}

function hourPrefix(date) {
  return `${GLM_PRODUCT}/${date.getUTCFullYear()}/${pad(dayOfYear(date), 3)}/${pad(date.getUTCHours())}/`;
}

export function glmTimestampForKey(key) {
  // GOES start token: sYYYYDDDHHMMSSd (d = tenths of a second).
  const match = String(key).match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)/);
  if (!match) return null;
  const [, year, doy, hour, minute, second, tenth] = match;
  const date = new Date(Date.UTC(+year, 0, 1, +hour, +minute, +second, +tenth * 100));
  date.setUTCDate(+doy);
  return date;
}

export function glmKeysFromS3Listing(xml) {
  const keys = [];
  const pattern = /<Key>([^<]+)<\/Key>/g;
  let match;
  while ((match = pattern.exec(String(xml))) !== null) {
    const key = match[1]
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
    if (key.includes('OR_GLM-L2-LCFA_G19_') && glmTimestampForKey(key)) keys.push(key);
  }
  return keys;
}

export async function listRecentGlmFiles({
  now = new Date(),
  fetchImpl = fetch,
  signal,
  hours = 2,
  maxFiles = 18,
} = {}) {
  const prefixes = [];
  for (let back = 0; back < hours; back++) {
    const prefix = hourPrefix(new Date(now.getTime() - back * 3600000));
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }

  const listings = await Promise.allSettled(prefixes.map(async (prefix) => {
    const query = new URLSearchParams({
      'list-type': '2', prefix, 'max-keys': '1000',
    });
    const response = await fetchImpl(`${GLM_BUCKET}/?${query}`, {
      cache: 'no-store', signal,
    });
    if (!response.ok) throw new Error(`GOES GLM listing failed: ${response.status}`);
    return glmKeysFromS3Listing(await response.text());
  }));

  const keys = listings
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
  if (!keys.length && listings.some(result => result.status === 'rejected')) {
    throw listings.find(result => result.status === 'rejected').reason;
  }

  const futureTolerance = now.getTime() + 60000;
  // Do not turn an upstream outage into apparently current lightning. A normal
  // file arrives in well under a minute; fifteen minutes leaves ample latency
  // tolerance while failing safely during a prolonged feed interruption.
  const freshnessCutoff = now.getTime() - 15 * 60000;
  return [...new Set(keys)]
    .map(key => ({ key, time: glmTimestampForKey(key) }))
    .filter(file => file.time && file.time.getTime() >= freshnessCutoff &&
      file.time.getTime() <= futureTolerance)
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(1, maxFiles));
}

function validCoordinate(value, fill, min, max) {
  return Number.isFinite(value) && value !== fill && value >= min && value <= max;
}

export async function decodeGlmFlashes(bytes, file) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const h5 = new HDF5File(input);
  const [latitudes, longitudes] = await Promise.all([
    h5.readVariable('flash_lat'),
    h5.readVariable('flash_lon'),
  ]);
  const length = Math.min(latitudes.data.length, longitudes.data.length);
  const observedAt = (file.time || glmTimestampForKey(file.key) || new Date()).toISOString();
  const features = [];

  for (let index = 0; index < length; index++) {
    const lat = Number(latitudes.data[index]);
    const lon = Number(longitudes.data[index]);
    if (!validCoordinate(lat, latitudes.fill, -90, 90) ||
        !validCoordinate(lon, longitudes.fill, -180, 180)) continue;
    features.push({
      type: 'Feature',
      id: `${file.key}:${index}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { observedAt },
    });
  }
  return features;
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function loadRecentGlmGeoJson({
  now = new Date(),
  fetchImpl = fetch,
  signal,
  maxFiles = 18,
} = {}) {
  const files = await listRecentGlmFiles({ now, fetchImpl, signal, maxFiles });
  if (!files.length) throw new Error('No recent GOES-19 GLM files were found');

  const decoded = await mapConcurrent(files, 4, async (file) => {
    const response = await fetchImpl(`${GLM_BUCKET}/${file.key}`, {
      cache: 'force-cache', signal,
    });
    if (!response.ok) throw new Error(`GOES GLM download failed: ${response.status}`);
    return decodeGlmFlashes(await response.arrayBuffer(), file);
  });
  const successful = decoded.filter(result => result.status === 'fulfilled');
  if (!successful.length) {
    throw decoded.find(result => result.status === 'rejected')?.reason ||
      new Error('Recent GOES-19 GLM files could not be decoded');
  }

  const latestTime = files[files.length - 1].time;
  const cutoff = latestTime.getTime() - GLM_WINDOW_MINUTES * 60000;
  const features = successful
    .flatMap(result => result.value)
    .filter(feature => Date.parse(feature.properties.observedAt) >= cutoff)
    .slice(-30000);
  for (const feature of features) {
    feature.properties.ageMinutes = Math.max(
      0, (latestTime.getTime() - Date.parse(feature.properties.observedAt)) / 60000,
    );
  }

  return {
    type: 'FeatureCollection',
    features,
    properties: {
      satellite: 'GOES-19',
      product: 'GLM-L2-LCFA',
      latestTime: latestTime.toISOString(),
      windowMinutes: GLM_WINDOW_MINUTES,
    },
  };
}
