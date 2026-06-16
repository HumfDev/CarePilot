export interface FacilityScoreComponents {
  infoRichness: number | null;
  sourceCredibility: number | null;
  clinicalCapacity: number | null;
  extraSignals: number | null;
  geoQuality: number | null;
}

export interface FacilityNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  // v4-scored extras (null when the synced table is not in place yet)
  trustScore: number | null;
  components: FacilityScoreComponents | null;
  sourceCount: number | null;
  isHospital: boolean | null;
  nfhsMatched: boolean | null;
  coordSource: string | null;
  // Optional fields for map search scoring (UC / SQL API)
  trustScoreV2?: number | null;
  sourceCredibilityScore?: number | null;
  description?: string | null;
  specialties?: string | null;
  capability?: string | null;
  procedure?: string | null;
  equipment?: string | null;
  facilityTypeId?: string | null;
  numberDoctors?: string | null;
  capacity?: string | null;
}

export interface FacilitiesMeta {
  count: number;
  scored: number;
  unscored: number;
  hasV4Scores: boolean;
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
