import type { FacilityNode } from '../../types/facility';
import { haversineKm } from './haversine';

export function snapToNearestFacility(
  lat: number,
  lng: number,
  facilities: FacilityNode[],
  maxRadiusKm: number,
): { facility: FacilityNode; distanceKm: number } | null {
  let best: FacilityNode | null = null;
  let bestDist = Infinity;

  for (const facility of facilities) {
    const dist = haversineKm(lat, lng, facility.lat, facility.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = facility;
    }
  }

  if (!best || bestDist > maxRadiusKm) return null;
  return { facility: best, distanceKm: bestDist };
}
