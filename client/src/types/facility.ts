export interface FacilityNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
}

export interface SelectedPoint {
  facility: FacilityNode;
  clickLat: number;
  clickLng: number;
  snapDistanceKm: number;
}

export interface RouteResult {
  path: FacilityNode[];
  distanceKm: number;
}
