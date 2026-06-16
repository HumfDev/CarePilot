import dijkstra from 'dijkstrajs';
import type { FacilityNode, RouteResult } from '../../types/facility';

export function findShortestPath(
  graph: Record<string, Record<string, number>>,
  startId: string,
  endId: string,
  facilitiesById: Map<string, FacilityNode>,
): RouteResult | null {
  if (startId === endId) {
    const node = facilitiesById.get(startId);
    return node ? { path: [node], distanceKm: 0 } : null;
  }

  try {
    const pathIds = dijkstra.find_path(graph, startId, endId);
    const path = pathIds
      .map((id) => facilitiesById.get(id))
      .filter((node): node is FacilityNode => node !== undefined);

    if (path.length !== pathIds.length) return null;

    let distanceKm = 0;
    for (let i = 0; i < pathIds.length - 1; i++) {
      const weight = graph[pathIds[i]]?.[pathIds[i + 1]];
      if (weight === undefined) return null;
      distanceKm += weight;
    }

    return { path, distanceKm };
  } catch {
    return null;
  }
}
