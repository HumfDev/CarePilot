/**
 * Contract returned by `POST /api/route/mock`.
 *
 * This is **not** live traffic data — it is a deterministic mock used for
 * demo purposes only. The `is_mock` flag and `disclaimer` field are
 * required by the UI so the planner can never be misled.
 */

export type TrafficLevel = 'Light' | 'Moderate' | 'Heavy';

export interface MockRoute {
  facility_id: string;
  facility_name: string;
  distance_km: number;
  eta_minutes: number;
  base_eta_minutes: number;
  traffic_delay_minutes: number;
  traffic_level: TrafficLevel;
  traffic_multiplier: number;
  is_mock: true;
  disclaimer: string;
  route_polyline: [number, number][];
  polyline_source: 'straight_line' | 'dijkstra_provided';
}
