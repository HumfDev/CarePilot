import { useEffect, useMemo, useState } from 'react';
import { buildFacilityGraph } from '../lib/routing/buildGraph';
import type { FacilityNode, FacilitiesMeta, FacilityScoreComponents } from '../types/facility';

interface UseFacilitiesResult {
  facilities: FacilityNode[];
  facilitiesById: Map<string, FacilityNode>;
  graph: Record<string, Record<string, number>> | null;
  meta: FacilitiesMeta | null;
  loading: boolean;
  error: string | null;
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', '1', 'yes', 't'].includes(value.toLowerCase());
  return null;
}

function normalizeComponents(value: unknown): FacilityScoreComponents | null {
  if (value == null || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  return {
    infoRichness: asOptionalNumber(c.infoRichness ?? c.info_richness_score),
    sourceCredibility: asOptionalNumber(c.sourceCredibility ?? c.source_credibility_score),
    clinicalCapacity: asOptionalNumber(c.clinicalCapacity ?? c.clinical_capacity_score),
    extraSignals: asOptionalNumber(c.extraSignals ?? c.extra_signals_score),
    geoQuality: asOptionalNumber(c.geoQuality ?? c.geo_quality_score),
  };
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
        trustScore: asOptionalNumber(row.trustScore ?? row.trust_score_v2),
        components: normalizeComponents(row.components),
        sourceCount: asOptionalNumber(row.sourceCount ?? row.source_count),
        isHospital: asOptionalBoolean(row.isHospital ?? row.is_hospital),
        nfhsMatched: asOptionalBoolean(row.nfhsMatched ?? row.nfhs_matched),
        coordSource: row.coordSource != null ? asString(row.coordSource) : null,
      } satisfies FacilityNode;
    })
    .filter((node): node is FacilityNode => node !== null);
}

interface FetchResult {
  facilities: FacilityNode[];
  meta: FacilitiesMeta | null;
}

async function fetchFacilities(): Promise<FetchResult> {
  const response = await fetch('/api/map/facilities?limit=5000');
  if (response.ok) {
    const data = (await response.json()) as {
      facilities?: unknown[];
      meta?: FacilitiesMeta;
    };
    if (data.facilities?.length) {
      return {
        facilities: normalizeFacilities(data.facilities),
        meta: data.meta ?? null,
      };
    }
  }

  const fallback = await fetch('/geo/facilities-fallback.json');
  if (!fallback.ok) {
    throw new Error('Unable to load facility data');
  }
  const fallbackData = (await fallback.json()) as { facilities: unknown[] };
  return {
    facilities: normalizeFacilities(fallbackData.facilities),
    meta: null,
  };
}

export function useFacilities(): UseFacilitiesResult {
  const [facilities, setFacilities] = useState<FacilityNode[]>([]);
  const [meta, setMeta] = useState<FacilitiesMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchFacilities()
      .then(({ facilities: nodes, meta: m }) => {
        if (!cancelled) {
          setFacilities(nodes);
          setMeta(m);
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

  const facilitiesById = useMemo(() => new Map(facilities.map((facility) => [facility.id, facility])), [facilities]);

  const graph = useMemo(() => (facilities.length > 0 ? buildFacilityGraph(facilities) : null), [facilities]);

  return { facilities, facilitiesById, graph, meta, loading, error };
}
