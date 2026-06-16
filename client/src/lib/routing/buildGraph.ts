import type { FacilityNode } from '../../types/facility';
import { haversineKm } from './haversine';

export interface GraphOptions {
  maxEdgeKm: number;
  kNearest: number;
}

const DEFAULT_OPTIONS: GraphOptions = {
  maxEdgeKm: 100,
  kNearest: 10,
};

export function buildFacilityGraph(
  facilities: FacilityNode[],
  options: Partial<GraphOptions> = {},
): Record<string, Record<string, number>> {
  const { maxEdgeKm, kNearest } = { ...DEFAULT_OPTIONS, ...options };
  const useSparseGuardrails = facilities.length >= 50;
  const neighborCount = useSparseGuardrails
    ? kNearest
    : Math.max(1, facilities.length - 1);
  const edgeLimitKm = useSparseGuardrails ? maxEdgeKm : Number.POSITIVE_INFINITY;
  const graph: Record<string, Record<string, number>> = {};

  for (const facility of facilities) {
    graph[facility.id] = {};
  }

  for (let i = 0; i < facilities.length; i++) {
    const source = facilities[i];
    const neighbors: { id: string; dist: number }[] = [];

    for (let j = 0; j < facilities.length; j++) {
      if (i === j) continue;
      const target = facilities[j];
      const dist = haversineKm(source.lat, source.lng, target.lat, target.lng);
      if (dist <= edgeLimitKm) {
        neighbors.push({ id: target.id, dist });
      }
    }

    neighbors.sort((a, b) => a.dist - b.dist);
    for (const { id, dist } of neighbors.slice(0, neighborCount)) {
      graph[source.id][id] = dist;
      graph[id][source.id] = dist;
    }
  }

  return graph;
}
