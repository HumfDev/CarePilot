import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { FeatureCollection } from 'geojson';

export function isPointInIndia(
  lat: number,
  lng: number,
  indiaBoundary: FeatureCollection,
): boolean {
  const clickPoint = point([lng, lat]);

  for (const feature of indiaBoundary.features) {
    const geometry = feature.geometry;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      if (booleanPointInPolygon(clickPoint, geometry)) {
        return true;
      }
    }
  }

  return false;
}
