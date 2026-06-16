/**
 * Thin client for the OSRM Route API (OpenStreetMap road network).
 *
 * Uses lon,lat coordinate order per the OSRM spec. Returns Leaflet-friendly
 * [lat, lon] polylines. This is **not** live traffic — durations follow OSRM's
 * default speed profiles on the road graph.
 */
export type LatLon = [number, number];

export interface OsrmRouteResult {
  distance_km: number;
  duration_minutes: number;
  route_polyline: LatLon[];
}

const DEFAULT_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_TIMEOUT_MS = 12_000;

function baseUrl(): string {
  return (process.env.OSRM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

function timeoutMs(): number {
  const n = Number(process.env.OSRM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function toLeafletPolyline(geojsonCoords: unknown): LatLon[] | null {
  if (!Array.isArray(geojsonCoords) || geojsonCoords.length < 2) return null;
  const out: LatLon[] = [];
  for (const pt of geojsonCoords) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }
  return out.length >= 2 ? out : null;
}

/**
 * Fetch a driving route between origin and destination.
 * Returns null when OSRM is unreachable or cannot find a route.
 */
export async function fetchOsrmDrivingRoute(
  origin: LatLon,
  destination: LatLon,
): Promise<OsrmRouteResult | null> {
  const [oLat, oLon] = origin;
  const [dLat, dLon] = destination;
  const path = `${oLon},${oLat};${dLon},${dLat}`;
  const url =
    `${baseUrl()}/route/v1/driving/${path}` +
    '?overview=full&geometries=geojson&steps=false';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: unknown };
      }>;
    };

    if (data.code !== 'Ok' || !data.routes?.length) return null;

    const route = data.routes[0];
    const distanceM = Number(route.distance);
    const durationS = Number(route.duration);
    if (!Number.isFinite(distanceM) || !Number.isFinite(durationS) || durationS <= 0) {
      return null;
    }

    const polyline = toLeafletPolyline(route.geometry?.coordinates);
    if (!polyline) return null;

    return {
      distance_km: distanceM / 1000,
      duration_minutes: durationS / 60,
      route_polyline: polyline,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function routeEngineMode(): 'mock' | 'osrm' | 'osrm_with_fallback' {
  const raw = (process.env.ROUTE_ENGINE ?? 'osrm_with_fallback').trim().toLowerCase();
  if (raw === 'mock' || raw === 'osrm' || raw === 'osrm_with_fallback') return raw;
  return 'osrm_with_fallback';
}
