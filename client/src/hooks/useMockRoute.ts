/**
 * useMockRoute — encapsulates the demo ETA request lifecycle.
 *
 * The hook keeps the latest mock route, plus loading / error state. It also
 * exposes a `clear()` so the caller (IndiaMapPanel / ChatPage) can drop the
 * polyline when the planner changes selection or starts a new search.
 *
 * The route itself is **never** used by the recommendation score — keep the
 * polyline + ETA confined to the map visualisation.
 */
import { useCallback, useState } from 'react';
import type { MockRoute } from '../types/route';

interface RequestArgs {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  facility_id: string;
  facility_name: string;
  /** Optional existing route polyline (e.g. from Dijkstra). */
  existing_polyline?: [number, number][];
}

interface UseMockRouteState {
  route: MockRoute | null;
  activeFacilityId: string | null;
  loading: boolean;
  error: string | null;
}

export interface UseMockRouteReturn extends UseMockRouteState {
  fetchRoute: (args: RequestArgs) => Promise<MockRoute | null>;
  clear: () => void;
}

export function useMockRoute(): UseMockRouteReturn {
  const [state, setState] = useState<UseMockRouteState>({
    route: null,
    activeFacilityId: null,
    loading: false,
    error: null,
  });

  const fetchRoute = useCallback(async (args: RequestArgs): Promise<MockRoute | null> => {
    setState({ route: null, activeFacilityId: args.facility_id, loading: true, error: null });
    try {
      const res = await fetch('/api/route/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok || !parsed || typeof parsed !== 'object') {
        const message =
          parsed &&
          typeof parsed === 'object' &&
          'error' in parsed &&
          typeof (parsed as { error?: unknown }).error === 'string'
            ? (parsed as { error: string }).error
            : `HTTP ${res.status}`;
        setState({ route: null, activeFacilityId: args.facility_id, loading: false, error: message });
        return null;
      }
      const route = parsed as MockRoute;
      setState({ route, activeFacilityId: route.facility_id, loading: false, error: null });
      return route;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mock route request failed.';
      setState({ route: null, activeFacilityId: args.facility_id, loading: false, error: message });
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setState({ route: null, activeFacilityId: null, loading: false, error: null });
  }, []);

  return { ...state, fetchRoute, clear };
}
