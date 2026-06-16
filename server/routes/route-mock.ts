/**
 * Mock routing ETA endpoint.
 *
 * Strictly for demo / planner-facing prototyping. There is NO live traffic
 * source. We compute a haversine distance, assume a 25 km/h urban speed,
 * and then apply a deterministic pseudo-random "traffic multiplier" derived
 * from the facility_id + origin + destination triple so the same query
 * always returns the same ETA within a session.
 *
 * Contract: see the user-facing card disclaimer below — never describe these
 * numbers as "live traffic" anywhere in the UI.
 *
 * Cache: in-process Map keyed by `facility_id|origin|destination` (lat/lon
 * quantised to 4 decimals). Single Node process is fine for the demo; for a
 * multi-replica deployment we would swap this for Lakebase or Redis.
 */
import type { Application, Request, Response } from 'express';

interface AppKitLike {
  server: { extend(fn: (app: Application) => void): void };
}

type LatLon = [number, number];
type TrafficLevel = 'Light' | 'Moderate' | 'Heavy';

interface MockRouteResponse {
  facility_id: string;
  facility_name: string;
  distance_km: number;
  eta_minutes: number;
  base_eta_minutes: number;
  traffic_delay_minutes: number;
  traffic_level: TrafficLevel;
  traffic_multiplier: number;
  is_mock: true;
  disclaimer: string;
  route_polyline: LatLon[];
  /** Source of the polyline so the UI can label it appropriately. */
  polyline_source: 'straight_line' | 'dijkstra_provided';
}

const URBAN_SPEED_KMH = 25;
const DISCLAIMER = 'Simulated ETA for demo purposes only; not live traffic.';
const MAX_CACHE_ENTRIES = 256;
const sessionCache = new Map<string, MockRouteResponse>();

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Stable, well-distributed 32-bit hash. FNV-1a is plenty for seeding our
 * single-shot PRNG and avoids pulling in a crypto dependency.
 */
function fnv1aHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Single sample of mulberry32 — returns a float in [0, 1). */
function seededUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
  t = (t ^ (t >>> 14)) >>> 0;
  return t / 4294967296;
}

function classifyTraffic(multiplier: number): TrafficLevel {
  if (multiplier < 1.15) return 'Light';
  if (multiplier < 1.4) return 'Moderate';
  return 'Heavy';
}

function quant(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function cacheKey(facility_id: string, origin: LatLon, destination: LatLon): string {
  return `${facility_id}|${quant(origin[0], origin[1])}|${quant(destination[0], destination[1])}`;
}

function parsePolyline(value: unknown): LatLon[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const out: LatLon[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const lat = Number(item[0]);
    const lon = Number(item[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }
  return out.length >= 2 ? out : null;
}

function evictOldestIfFull() {
  if (sessionCache.size < MAX_CACHE_ENTRIES) return;
  const firstKey = sessionCache.keys().next().value;
  if (firstKey !== undefined) sessionCache.delete(firstKey);
}

export function setupRouteMockRoutes(appkit: AppKitLike) {
  appkit.server.extend((app) => {
    app.post('/api/route/mock', (req: Request, res: Response) => {
      const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};

      const facility_id = typeof body.facility_id === 'string' ? body.facility_id.trim() : '';
      const facility_name = typeof body.facility_name === 'string' ? body.facility_name : '';
      const origin = body.origin as { lat?: unknown; lon?: unknown } | undefined;
      const destination = body.destination as { lat?: unknown; lon?: unknown } | undefined;
      const originLat = asNumber(origin?.lat);
      const originLon = asNumber(origin?.lon);
      const destLat = asNumber(destination?.lat);
      const destLon = asNumber(destination?.lon);

      if (!facility_id || originLat == null || originLon == null || destLat == null || destLon == null) {
        res.status(400).json({
          ok: false,
          error: 'facility_id, origin{lat,lon}, and destination{lat,lon} are all required.',
        });
        return;
      }

      const o: LatLon = [originLat, originLon];
      const d: LatLon = [destLat, destLon];
      const key = cacheKey(facility_id, o, d);

      // The client may pass an existing polyline (e.g. from the Dijkstra
      // routing layer). We honour it as-is so we never accidentally
      // overwrite a real route with a straight-line draw — but the ETA is
      // still mock so the disclaimer stays in place.
      const overridePolyline = parsePolyline(body.existing_polyline);

      const cached = sessionCache.get(key);
      if (cached && !overridePolyline) {
        res.json(cached);
        return;
      }

      const distance_km = haversineKm(originLat, originLon, destLat, destLon);
      const base_eta_minutes = (distance_km / URBAN_SPEED_KMH) * 60;
      const seed = fnv1aHash(key);
      const traffic_multiplier = 1.0 + seededUnit(seed) * 0.8; // [1.00, 1.80)
      const eta_minutes = base_eta_minutes * traffic_multiplier;
      const traffic_delay_minutes = eta_minutes - base_eta_minutes;
      const traffic_level = classifyTraffic(traffic_multiplier);

      const polyline: LatLon[] = overridePolyline ?? [o, d];
      const polyline_source: MockRouteResponse['polyline_source'] = overridePolyline
        ? 'dijkstra_provided'
        : 'straight_line';

      const response: MockRouteResponse = {
        facility_id,
        facility_name,
        distance_km: Number(distance_km.toFixed(2)),
        eta_minutes: Number(eta_minutes.toFixed(1)),
        base_eta_minutes: Number(base_eta_minutes.toFixed(1)),
        traffic_delay_minutes: Number(traffic_delay_minutes.toFixed(1)),
        traffic_level,
        traffic_multiplier: Number(traffic_multiplier.toFixed(3)),
        is_mock: true,
        disclaimer: DISCLAIMER,
        route_polyline: polyline,
        polyline_source,
      };

      // Only cache the deterministic (straight-line) variant; a client-supplied
      // polyline shouldn't pollute the cache for other callers.
      if (!overridePolyline) {
        evictOldestIfFull();
        sessionCache.set(key, response);
      }

      res.json(response);
    });
  });
}
