/**
 * Route ETA endpoint for the referral map.
 *
 * Default engine: **OSRM** (OpenStreetMap road network) with fallback to the
 * legacy haversine mock when OSRM is unavailable. Set `ROUTE_ENGINE=mock` to
 * force the demo-only straight-line estimator.
 *
 * OSRM durations follow default road speeds — **not** live traffic.
 */
import type { Application, Request, Response } from 'express';
import { fetchOsrmDrivingRoute, routeEngineMode, type LatLon } from '../lib/osrm-client';

interface AppKitLike {
  server: { extend(fn: (app: Application) => void): void };
}

type TrafficLevel = 'Light' | 'Moderate' | 'Heavy';

interface RouteResponse {
  facility_id: string;
  facility_name: string;
  distance_km: number;
  eta_minutes: number;
  base_eta_minutes: number;
  traffic_delay_minutes: number;
  traffic_level: TrafficLevel;
  traffic_multiplier: number;
  is_mock: boolean;
  route_engine: 'mock' | 'osrm';
  disclaimer: string;
  route_polyline: LatLon[];
  polyline_source: 'straight_line' | 'osrm' | 'dijkstra_provided';
}

const URBAN_SPEED_KMH = 25;
const MOCK_DISCLAIMER = 'Simulated ETA for demo purposes only; not live traffic.';
const OSRM_DISCLAIMER =
  'ETA from OpenStreetMap road network via OSRM; not live traffic — verify before travel.';
const MAX_CACHE_ENTRIES = 256;
const sessionCache = new Map<string, RouteResponse>();

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

function fnv1aHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

function cacheKey(facility_id: string, origin: LatLon, destination: LatLon, engine: string): string {
  return `${engine}|${facility_id}|${quant(origin[0], origin[1])}|${quant(destination[0], destination[1])}`;
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

function buildMockRoute(
  facility_id: string,
  facility_name: string,
  o: LatLon,
  d: LatLon,
  key: string,
  overridePolyline: LatLon[] | null,
): RouteResponse {
  const distance_km = haversineKm(o[0], o[1], d[0], d[1]);
  const base_eta_minutes = (distance_km / URBAN_SPEED_KMH) * 60;
  const seed = fnv1aHash(key);
  const traffic_multiplier = 1.0 + seededUnit(seed) * 0.8;
  const eta_minutes = base_eta_minutes * traffic_multiplier;
  const traffic_delay_minutes = eta_minutes - base_eta_minutes;

  const polyline: LatLon[] = overridePolyline ?? [o, d];
  const polyline_source: RouteResponse['polyline_source'] = overridePolyline
    ? 'dijkstra_provided'
    : 'straight_line';

  return {
    facility_id,
    facility_name,
    distance_km: Number(distance_km.toFixed(2)),
    eta_minutes: Number(eta_minutes.toFixed(1)),
    base_eta_minutes: Number(base_eta_minutes.toFixed(1)),
    traffic_delay_minutes: Number(traffic_delay_minutes.toFixed(1)),
    traffic_level: classifyTraffic(traffic_multiplier),
    traffic_multiplier: Number(traffic_multiplier.toFixed(3)),
    is_mock: true,
    route_engine: 'mock',
    disclaimer: MOCK_DISCLAIMER,
    route_polyline: polyline,
    polyline_source,
  };
}

function buildOsrmRoute(
  facility_id: string,
  facility_name: string,
  osrm: { distance_km: number; duration_minutes: number; route_polyline: LatLon[] },
  overridePolyline: LatLon[] | null,
): RouteResponse {
  const eta_minutes = osrm.duration_minutes;
  return {
    facility_id,
    facility_name,
    distance_km: Number(osrm.distance_km.toFixed(2)),
    eta_minutes: Number(eta_minutes.toFixed(1)),
    base_eta_minutes: Number(eta_minutes.toFixed(1)),
    traffic_delay_minutes: 0,
    traffic_level: 'Light',
    traffic_multiplier: 1,
    is_mock: false,
    route_engine: 'osrm',
    disclaimer: OSRM_DISCLAIMER,
    route_polyline: overridePolyline ?? osrm.route_polyline,
    polyline_source: overridePolyline ? 'dijkstra_provided' : 'osrm',
  };
}

export function setupRouteMockRoutes(appkit: AppKitLike) {
  appkit.server.extend((app) => {
    app.post('/api/route/mock', async (req: Request, res: Response) => {
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
      const engineMode = routeEngineMode();
      const overridePolyline = parsePolyline(body.existing_polyline);
      const key = cacheKey(facility_id, o, d, engineMode);

      const cached = sessionCache.get(key);
      if (cached && !overridePolyline) {
        res.json(cached);
        return;
      }

      let response: RouteResponse | null = null;

      if (engineMode !== 'mock') {
        const osrm = await fetchOsrmDrivingRoute(o, d);
        if (osrm) {
          response = buildOsrmRoute(facility_id, facility_name, osrm, overridePolyline);
        } else if (engineMode === 'osrm') {
          res.status(502).json({
            ok: false,
            error: 'OSRM routing failed and ROUTE_ENGINE=osrm does not allow mock fallback.',
          });
          return;
        }
      }

      if (!response) {
        const mockKey = cacheKey(facility_id, o, d, 'mock');
        response = buildMockRoute(facility_id, facility_name, o, d, mockKey, overridePolyline);
      }

      if (!overridePolyline) {
        evictOldestIfFull();
        sessionCache.set(key, response);
      }

      res.json(response);
    });
  });
}
