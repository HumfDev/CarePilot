export interface FacilityNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  pincode: string | null;
  district: string | null;
  facilityTypeId: string | null;
  operatorTypeId: string | null;
  yearEstablished: string | null;
  numberDoctors: string | null;
  capacity: string | null;
  description: string | null;
  specialties: string | null;
  capability: string | null;
  procedure: string | null;
  equipment: string | null;
  trustScoreV2: number | null;
  sourceCredibilityScore: number | null;
  sourceCount: number | null;
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
