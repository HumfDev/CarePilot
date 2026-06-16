import { useEffect, useMemo, useState } from 'react';
import { buildFacilityGraph } from '../lib/routing/buildGraph';
import type { FacilityNode } from '../types/facility';

interface UseFacilitiesResult {
  facilities: FacilityNode[];
  facilitiesById: Map<string, FacilityNode>;
  graph: Record<string, Record<string, number>> | null;
  loading: boolean;
  error: string | null;
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function normalizeFacilities(raw: unknown[]): FacilityNode[] {
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const lat = Number(row.lat ?? row.latitude);
      const lng = Number(row.lng ?? row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: asString(row.id ?? row.unique_id, 'unknown'),
        name: asString(row.name, 'Unknown facility'),
        lat,
        lng,
        city: row.city != null ? asString(row.city) : null,
        state: row.state != null ? asString(row.state) : null,
      } satisfies FacilityNode;
    })
    .filter((node): node is FacilityNode => node !== null);
}

async function fetchFacilities(): Promise<FacilityNode[]> {
  const response = await fetch('/api/map/facilities?limit=5000');
  if (response.ok) {
    const data = (await response.json()) as { facilities?: unknown[] };
    if (data.facilities?.length) {
      return normalizeFacilities(data.facilities);
    }
  }

  const fallback = await fetch('/geo/facilities-fallback.json');
  if (!fallback.ok) {
    throw new Error('Unable to load facility data');
  }
  const fallbackData = (await fallback.json()) as { facilities: unknown[] };
  return normalizeFacilities(fallbackData.facilities);
}

export function useFacilities(): UseFacilitiesResult {
  const [facilities, setFacilities] = useState<FacilityNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchFacilities()
      .then((nodes) => {
        if (!cancelled) {
          setFacilities(nodes);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load facilities');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const facilitiesById = useMemo(
    () => new Map(facilities.map((facility) => [facility.id, facility])),
    [facilities],
  );

  const graph = useMemo(
    () => (facilities.length > 0 ? buildFacilityGraph(facilities) : null),
    [facilities],
  );

  return { facilities, facilitiesById, graph, loading, error };
}
