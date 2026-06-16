import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { useFacilities } from '../hooks/useFacilities';
import { findShortestPath } from '../lib/routing/findRoute';
import { isPointInIndia } from '../lib/routing/isInIndia';
import { snapToNearestFacility } from '../lib/routing/snapToFacility';
import type { FacilityNode, RouteResult, SelectedPoint } from '../types/facility';
import type { ReferralCandidate } from '../types/referral';
import type { MockRoute } from '../types/route';
import { MockRouteSummary } from './MockRouteSummary';
import { PlannerLocationControl, type PlannerLocation } from './PlannerLocationControl';

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];
const SNAP_RADIUS_KM = 50;

// Tuned to the v4 trust_score_v2 distribution
// (mean 43.5, p10 25.8, p50 41.9, p90 63.0, max 96.3).
const SCORE_BUCKETS: ReadonlyArray<{ min: number; label: string; color: string }> = [
  { min: 70, label: 'Top (≥70)', color: '#22C55E' },
  { min: 55, label: 'High (55–70)', color: '#A3E635' },
  { min: 40, label: 'Mid (40–55)', color: '#F59E0B' },
  { min: 25, label: 'Low (25–40)', color: '#FB923C' },
  { min: 0, label: 'Bottom (<25)', color: '#EF4444' },
];
const UNSCORED_COLOR = '#525252';

function markerStyleForScore(score: number | null) {
  if (score == null) {
    return { color: UNSCORED_COLOR, fillColor: UNSCORED_COLOR, radius: 3 };
  }
  const bucket = SCORE_BUCKETS.find((b) => score >= b.min) ?? SCORE_BUCKETS[SCORE_BUCKETS.length - 1];
  // Linear radius 3..7 over score 0..100.
  const radius = 3 + Math.max(0, Math.min(100, score)) * 0.04;
  return { color: bucket.color, fillColor: bucket.color, radius };
}

function MapClickHandler({
  enabled,
  onMapClick,
}: {
  enabled: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onMapClick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function uncertaintyMarkerColor(level: string | null | undefined): string {
  const text = (level ?? '').toLowerCase();
  if (text.startsWith('low')) return '#22C55E';
  if (text.startsWith('medium')) return '#F59E0B';
  if (text.startsWith('high')) return '#EF4444';
  return '#A1A1AA';
}

function rankedRadius(candidate: ReferralCandidate, selected: boolean): number {
  const score = candidate.feedback_adjusted_score ?? candidate.final_recommendation_score ?? 50;
  const base = 12 + Math.max(0, Math.min(100, score)) * 0.06;
  return selected ? base + 4 : base;
}

function buildRankedDivIcon(candidate: ReferralCandidate, selected: boolean): L.DivIcon {
  const color = uncertaintyMarkerColor(candidate.uncertainty_level);
  const size = Math.round(rankedRadius(candidate, selected) * 2);
  return L.divIcon({
    className: 'referral-rank-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div style="
        display:flex;align-items:center;justify-content:center;
        width:${size}px;height:${size}px;border-radius:9999px;
        background:${color};color:#0a0a0a;font-weight:700;font-size:${Math.max(10, size * 0.4)}px;
        border:${selected ? '3px solid #FFFFFF' : '2px solid rgba(0,0,0,0.6)'};
        box-shadow:0 0 0 ${selected ? '4px rgba(99,102,241,0.45)' : '2px rgba(0,0,0,0.4)'};
      ">${candidate.rank}</div>
    `,
  });
}

function RankedCandidateMarkers({
  candidates,
  selectedCandidateId,
  routeFacilityId,
  onSelectCandidate,
}: {
  candidates: ReferralCandidate[];
  selectedCandidateId: string | null;
  routeFacilityId?: string | null;
  onSelectCandidate?: (id: string) => void;
}) {
  return (
    <>
      {candidates.map((candidate) => {
        if (candidate.latitude == null || candidate.longitude == null) return null;
        const isSelected = candidate.facility_id === selectedCandidateId;
        const isRouteTarget = routeFacilityId != null && candidate.facility_id === routeFacilityId;
        const icon = buildRankedDivIcon(candidate, isSelected || isRouteTarget);
        const score = candidate.feedback_adjusted_score ?? candidate.final_recommendation_score;
        return (
          <Marker
            key={candidate.facility_id}
            position={[candidate.latitude, candidate.longitude]}
            icon={icon}
            eventHandlers={{
              click: () => onSelectCandidate?.(candidate.facility_id),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <div className="text-xs leading-tight">
                <div className="font-semibold">
                  #{candidate.rank} {candidate.facility_name}
                </div>
                <div className="text-neutral-500">
                  {[candidate.clean_city, candidate.clean_state].filter(Boolean).join(', ')}
                </div>
                <div className="mt-0.5">
                  Score <span className="font-semibold">{(score ?? 0).toFixed(1)}</span> ·{' '}
                  {(candidate.distance_km ?? 0).toFixed(1)} km
                </div>
                <div className="text-neutral-500">{candidate.uncertainty_level ?? ''}</div>
                {candidate.evidence_snippets?.[0]?.text ? (
                  <div className="mt-0.5 max-w-[260px] text-[10px] italic text-neutral-400">
                    “{candidate.evidence_snippets[0].text.slice(0, 140)}
                    {candidate.evidence_snippets[0].text.length > 140 ? '…' : ''}”
                  </div>
                ) : null}
                <div className="mt-1 text-[10px] text-indigo-300">Open from ranked list for details</div>
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

function UserLocationMarker({ lat, lon }: { lat: number; lon: number }) {
  return (
    <CircleMarker
      center={[lat, lon]}
      radius={6}
      pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: '#6366F1', fillOpacity: 0.95 }}
    >
      <Tooltip permanent direction="top" offset={[0, -8]}>
        You / search origin
      </Tooltip>
    </CircleMarker>
  );
}

function MapPanToPoint({ lat, lon, zoom = 10 }: { lat: number; lon: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lon], { animate: true });
    if (map.getZoom() < zoom) map.setZoom(zoom);
  }, [lat, lon, zoom, map]);
  return null;
}

function MapFlyTo({
  candidates,
  userLocation,
  selectedCandidateId,
  routeFacilityId,
}: {
  candidates: ReferralCandidate[];
  userLocation: { lat: number; lon: number } | null;
  selectedCandidateId: string | null;
  routeFacilityId?: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!candidates.length || !userLocation) return;
    const points = candidates
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => [c.latitude as number, c.longitude as number] as [number, number]);
    points.push([userLocation.lat, userLocation.lon]);
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [candidates, userLocation, map]);

  const focusId = selectedCandidateId ?? routeFacilityId ?? null;

  useEffect(() => {
    if (!focusId) return;
    const selected = candidates.find((c) => c.facility_id === focusId);
    if (!selected || selected.latitude == null || selected.longitude == null) return;
    map.panTo([selected.latitude, selected.longitude], { animate: true });
  }, [focusId, candidates, map]);

  return null;
}

function FacilityMarkers({ facilities }: { facilities: FacilityNode[] }) {
  return (
    <>
      {facilities.map((facility) => {
        const style = markerStyleForScore(facility.trustScore);
        return (
          <CircleMarker
            key={facility.id}
            center={[facility.lat, facility.lng]}
            radius={style.radius}
            pathOptions={{
              color: style.color,
              fillColor: style.fillColor,
              fillOpacity: 0.75,
              weight: 1,
            }}
          >
            <Tooltip sticky>
              <div className="text-xs leading-tight">
                <div className="font-semibold">{facility.name}</div>
                {facility.city || facility.state ? (
                  <div className="text-neutral-500">{[facility.city, facility.state].filter(Boolean).join(', ')}</div>
                ) : null}
                {facility.trustScore != null ? (
                  <div className="mt-0.5">
                    Trust: <span className="font-semibold">{facility.trustScore.toFixed(1)}</span>
                    {facility.sourceCount != null ? (
                      <span className="ml-1 text-neutral-500">· {facility.sourceCount} src</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-0.5 text-neutral-500">Trust score unavailable</div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

interface IndiaMapPanelProps {
  candidates?: ReferralCandidate[];
  selectedCandidateId?: string | null;
  routeFacilityId?: string | null;
  onSelectCandidate?: (candidateId: string) => void;
  userLocation?: { lat: number; lon: number } | null;
  plannerLocation?: PlannerLocation | null;
  onPlannerLocationChange?: (location: PlannerLocation | null) => void;
  activeMockRoute?: MockRoute | null;
  mockRouteLoading?: boolean;
  mockRouteError?: string | null;
  onClearMockRoute?: () => void;
}

function ScoreLegend({ hasScores, hidden }: { hasScores: boolean; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <div className="absolute right-3 top-3 z-[1000]">
      {open ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/85 px-2.5 py-2 text-[10px] text-neutral-300 backdrop-blur-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold uppercase tracking-wide text-neutral-400">Trust score (v4)</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-neutral-700 px-1 text-[9px] text-neutral-400 hover:bg-neutral-800"
              aria-label="Hide trust score legend"
            >
              Hide
            </button>
          </div>
          {!hasScores && <div className="mb-1.5 text-neutral-500">v4 sync not set up — markers are neutral.</div>}
          <div className="flex flex-col gap-1">
            {SCORE_BUCKETS.map((b) => (
              <div key={b.label} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: b.color }}
                  aria-hidden="true"
                />
                <span>{b.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: UNSCORED_COLOR }}
                aria-hidden="true"
              />
              <span>Unscored</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-neutral-800 bg-neutral-950/85 px-2 py-1 text-[10px] text-neutral-400 backdrop-blur-sm hover:bg-neutral-900"
        >
          Trust score legend
        </button>
      )}
    </div>
  );
}

const ROUTE_POLYLINE_OPTIONS = {
  color: '#6366F1',
  weight: 4,
  opacity: 0.85,
  dashArray: '6 4',
};

export function IndiaMapPanel({
  candidates = [],
  selectedCandidateId = null,
  routeFacilityId = null,
  onSelectCandidate,
  userLocation = null,
  plannerLocation = null,
  onPlannerLocationChange,
  activeMockRoute = null,
  mockRouteLoading = false,
  mockRouteError = null,
  onClearMockRoute,
}: IndiaMapPanelProps = {}) {
  const { facilities, facilitiesById, graph, meta, loading, error } = useFacilities();
  const hasCandidates = candidates.length > 0;
  const [indiaBoundary, setIndiaBoundary] = useState<FeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const [start, setStart] = useState<SelectedPoint | null>(null);
  const [end, setEnd] = useState<SelectedPoint | null>(null);
  const [selectionStep, setSelectionStep] = useState<'start' | 'end'>('start');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [locationPickMode, setLocationPickMode] = useState(false);

  useEffect(() => {
    fetch('/geo/india-adm0.geojson')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load India boundary');
        return res.json() as Promise<FeatureCollection>;
      })
      .then(setIndiaBoundary)
      .catch((err: unknown) => {
        setBoundaryError(err instanceof Error ? err.message : 'Failed to load map boundary');
      });
  }, []);

  const computeRoute = useCallback(
    (startPoint: SelectedPoint, endPoint: SelectedPoint) => {
      if (!graph) return null;
      return findShortestPath(graph, startPoint.facility.id, endPoint.facility.id, facilitiesById);
    },
    [graph, facilitiesById]
  );

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!indiaBoundary) return;

      if (locationPickMode && onPlannerLocationChange) {
        if (!isPointInIndia(lat, lng, indiaBoundary)) {
          setStatusMessage('My location must be inside India.');
          return;
        }
        const next = { lat, lon: lng };
        onPlannerLocationChange(next);
        setLocationPickMode(false);
        setStatusMessage(`My location set to ${lat.toFixed(4)}, ${lng.toFixed(4)}.`);
        return;
      }

      if (hasCandidates || facilities.length === 0) return;

      if (!isPointInIndia(lat, lng, indiaBoundary)) {
        setStatusMessage('Click must be inside India.');
        setRoute(null);
        return;
      }

      const snap = snapToNearestFacility(lat, lng, facilities, SNAP_RADIUS_KM);
      if (!snap) {
        setStatusMessage(`No facility within ${SNAP_RADIUS_KM} km of this location.`);
        setRoute(null);
        return;
      }

      const selected: SelectedPoint = {
        facility: snap.facility,
        clickLat: lat,
        clickLng: lng,
        snapDistanceKm: snap.distanceKm,
      };

      if (selectionStep === 'start') {
        setStart(selected);
        setEnd(null);
        setRoute(null);
        setSelectionStep('end');
        setStatusMessage(
          `Start: ${snap.facility.name} (${snap.distanceKm.toFixed(1)} km from click). Click destination.`
        );
        return;
      }

      setEnd(selected);
      setSelectionStep('start');
      const nextRoute = start ? computeRoute(start, selected) : null;
      setRoute(nextRoute);

      if (nextRoute) {
        setStatusMessage(`Route: ${nextRoute.path.length} facilities, ${nextRoute.distanceKm.toFixed(1)} km total.`);
      } else {
        setStatusMessage('No connected route between these facilities. Try closer points or increase edge radius.');
      }
    },
    [indiaBoundary, facilities, selectionStep, start, computeRoute, locationPickMode, onPlannerLocationChange, hasCandidates],
  );

  const clearRoute = () => {
    setStart(null);
    setEnd(null);
    setRoute(null);
    setSelectionStep('start');
    setStatusMessage('Selection cleared. Click to set a start facility.');
  };

  const swapPoints = () => {
    if (!start || !end) return;
    const nextStart = end;
    const nextEnd = start;
    setStart(nextStart);
    setEnd(nextEnd);
    const nextRoute = computeRoute(nextStart, nextEnd);
    setRoute(nextRoute);
    setStatusMessage(
      nextRoute
        ? `Route: ${nextRoute.path.length} facilities, ${nextRoute.distanceKm.toFixed(1)} km total.`
        : 'No connected route between these facilities.'
    );
  };

  const routePositions = useMemo(
    () => route?.path.map((node) => [node.lat, node.lng] as [number, number]) ?? [],
    [route]
  );

  const mapReady = !loading && !error && indiaBoundary && facilities.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950" data-testid="india-map-panel">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">India Healthcare Map</h2>
          <p className="text-xs text-neutral-500">
            {locationPickMode
              ? 'Click inside India to set your planner location.'
              : hasCandidates
                ? 'Ranked referral candidates — set my location for route ETA.'
                : 'Click twice to route between nearest facilities (Dijkstra)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={swapPoints}
            disabled={!start || !end}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Swap
          </button>
          <button
            type="button"
            onClick={clearRoute}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
        {loading && 'Loading facilities…'}
        {error && `Facility error: ${error}. Using fallback data if available.`}
        {boundaryError && `Boundary error: ${boundaryError}`}
        {!loading && !error && statusMessage && statusMessage}
        {!loading &&
          !error &&
          !statusMessage &&
          selectionStep === 'start' &&
          'Click the map to select a start facility.'}
        {!loading &&
          !error &&
          !statusMessage &&
          selectionStep === 'end' &&
          'Click the map to select a destination facility.'}
        {route && (
          <span className="ml-2 text-neutral-300">
            Distance: {route.distanceKm.toFixed(1)} km · Stops: {route.path.length}
          </span>
        )}
        {meta && (
          <span className="ml-2 text-neutral-500">
            · {meta.scored.toLocaleString()} / {meta.count.toLocaleString()} scored (v4)
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {!mapReady ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            {loading ? 'Loading map data…' : 'Preparing map…'}
          </div>
        ) : (
          <MapContainer center={INDIA_CENTER} zoom={5} className="h-full w-full" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <GeoJSON
              data={indiaBoundary}
              style={{
                color: '#007AFF',
                weight: 1,
                fillColor: '#007AFF',
                fillOpacity: 0.05,
              }}
            />
            {hasCandidates ? (
              <RankedCandidateMarkers
                candidates={candidates}
                selectedCandidateId={selectedCandidateId}
                routeFacilityId={routeFacilityId}
                onSelectCandidate={onSelectCandidate}
              />
            ) : (
              <FacilityMarkers facilities={facilities} />
            )}
            <ScoreLegend hasScores={meta?.hasV4Scores ?? false} hidden={hasCandidates} />
            {userLocation ? <UserLocationMarker lat={userLocation.lat} lon={userLocation.lon} /> : null}
            {plannerLocation ? (
              <MapPanToPoint lat={plannerLocation.lat} lon={plannerLocation.lon} />
            ) : null}
            <MapFlyTo
              candidates={candidates}
              userLocation={userLocation}
              selectedCandidateId={selectedCandidateId}
              routeFacilityId={routeFacilityId}
            />
            {start && (
              <CircleMarker
                center={[start.facility.lat, start.facility.lng]}
                radius={8}
                pathOptions={{ color: '#32D74B', fillColor: '#32D74B', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  Start: {start.facility.name}
                </Tooltip>
              </CircleMarker>
            )}
            {end && (
              <CircleMarker
                center={[end.facility.lat, end.facility.lng]}
                radius={8}
                pathOptions={{ color: '#FF453A', fillColor: '#FF453A', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  End: {end.facility.name}
                </Tooltip>
              </CircleMarker>
            )}
            {routePositions.length > 1 && (
              <Polyline positions={routePositions} pathOptions={{ color: '#007AFF', weight: 4, opacity: 0.85 }} />
            )}
            {activeMockRoute?.route_polyline ? (
              <Polyline positions={activeMockRoute.route_polyline} pathOptions={ROUTE_POLYLINE_OPTIONS} />
            ) : null}
            <MapClickHandler enabled={mapReady} onMapClick={handleMapClick} />
          </MapContainer>
        )}
        {mockRouteLoading && !activeMockRoute ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-md">
            <div className="pointer-events-auto rounded-lg border border-neutral-800 bg-neutral-950/90 px-4 py-3 text-[11px] text-neutral-400 shadow-lg backdrop-blur-sm animate-pulse">
              Calculating simulated ETA…
            </div>
          </div>
        ) : null}
        {mockRouteError ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-md">
            <div className="pointer-events-auto rounded-lg border border-rose-500/30 bg-neutral-950/90 px-4 py-3 text-[11px] text-rose-300 shadow-lg backdrop-blur-sm">
              {mockRouteError}
            </div>
          </div>
        ) : null}
        {activeMockRoute && onClearMockRoute ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-md">
            <div className="pointer-events-auto">
              <MockRouteSummary route={activeMockRoute} onClear={onClearMockRoute} />
            </div>
          </div>
        ) : null}
        {onPlannerLocationChange ? (
          <PlannerLocationControl
            location={plannerLocation}
            onChange={onPlannerLocationChange}
            pickMode={locationPickMode}
            onPickModeChange={setLocationPickMode}
          />
        ) : null}
      </div>
    </div>
  );
}
