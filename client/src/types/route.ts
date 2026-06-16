/**
 * Contract returned by `POST /api/route/mock`.
 *
 * When `route_engine` is `osrm`, distance/ETA/polyline come from the OSRM
 * road network (OpenStreetMap). When `route_engine` is `mock`, values are a
 * deterministic straight-line demo. Neither mode is live traffic.
 */

export type TrafficLevel = 'Light' | 'Moderate' | 'Heavy';

export type RoutePolylineSource = 'straight_line' | 'osrm' | 'dijkstra_provided';

export interface MockRoute {
  facility_id: string;
  facility_name: string;
  distance_km: number;
  eta_minutes: number;
  base_eta_minutes: number;
  traffic_delay_minutes: number;
  traffic_level: TrafficLevel;
  traffic_multiplier: number;
  is_mock: boolean;
  route_engine: 'mock' | 'osrm';
  disclaimer: string;
  route_polyline: [number, number][];
  polyline_source: RoutePolylineSource;
}
