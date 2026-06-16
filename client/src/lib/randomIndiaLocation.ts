/** Demo planner origin — random point inside India's approximate bounding box. */
export function randomIndiaLocation(): { lat: number; lon: number } {
  const lat = 8.5 + Math.random() * 26.5;
  const lon = 68.0 + Math.random() * 29.0;
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

export function formatCoord(value: number, digits = 4): string {
  return value.toFixed(digits);
}
