import { useCallback, useEffect, useState } from 'react';
import {
  Circle,
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
import { isPointInIndia } from '../lib/routing/isInIndia';
import type { ReferralCandidate } from '../types/referral';
import type { MockRoute } from '../types/route';
import { MockRouteSummary } from './MockRouteSummary';
import { MapSearchSidebar } from './MapSearchSidebar';
import type { PlannerLocation } from './PlannerLocationControl';

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];

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
  referralFeedbackApplied?: boolean;
  careNeedHint?: string | null;
  locationHint?: string | null;
  searchRadiusKm?: number | null;
  searchLoading?: boolean;
  searchError?: string | null;
  onSidebarSearch?: (input: { city: string; careNeed: string }) => Promise<void>;
  onClearSearch?: () => void;
  onShowReferralRoute?: (candidate: ReferralCandidate) => void;
}

function ScoreLegend({ hasScores, hidden }: { hasScores: boolean; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <div className="absolute right-3 top-3 z-[1000]">
      {open ? (
        <div className="rounded-md border border-neutral-200 bg-white/95 px-2.5 py-2 text-[10px] text-neutral-600 backdrop-blur-sm shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold uppercase tracking-wide text-neutral-500">Trust score (v4)</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-neutral-200 px-1 text-[9px] text-neutral-500 hover:bg-neutral-50"
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
          className="rounded-md border border-neutral-200 bg-white/95 px-2 py-1 text-[10px] text-neutral-600 backdrop-blur-sm shadow-sm hover:bg-neutral-50"
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
  referralFeedbackApplied,
  careNeedHint,
  locationHint,
  searchRadiusKm,
  searchLoading = false,
  searchError = null,
  onSidebarSearch,
  onClearSearch,
  onShowReferralRoute,
}: IndiaMapPanelProps = {}) {
  const { meta, loading } = useFacilities();
  const hasCandidates = candidates.length > 0;
  const [indiaBoundary, setIndiaBoundary] = useState<FeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
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

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!indiaBoundary) return;

      if (locationPickMode && onPlannerLocationChange) {
        if (!isPointInIndia(lat, lng, indiaBoundary)) return;
        onPlannerLocationChange({ lat, lon: lng });
        setLocationPickMode(false);
        return;
      }
    },
    [indiaBoundary, locationPickMode, onPlannerLocationChange],
  );

  const mapReady = !loading && indiaBoundary != null;

  return (
    <div className="flex h-full min-h-0 bg-white" data-testid="india-map-panel">
      {onPlannerLocationChange && onSidebarSearch && onClearSearch && onSelectCandidate && onShowReferralRoute ? (
        <MapSearchSidebar
          boundaryError={boundaryError}
          plannerLocation={plannerLocation}
          onPlannerLocationChange={onPlannerLocationChange}
          onPickModeChange={setLocationPickMode}
          pickMode={locationPickMode}
          candidates={candidates}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={onSelectCandidate}
          feedbackApplied={referralFeedbackApplied}
          careNeedHint={careNeedHint}
          locationHint={locationHint}
          searchLoading={searchLoading}
          searchError={searchError}
          onSearch={onSidebarSearch}
          onClear={onClearSearch}
          userLocation={userLocation}
          routeFacilityId={routeFacilityId}
          route={activeMockRoute}
          routeLoading={mockRouteLoading}
          onShowRoute={onShowReferralRoute}
          onClearRoute={onClearMockRoute}
        />
      ) : null}

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
              <>
                {userLocation && searchRadiusKm ? (
                  <Circle
                    center={[userLocation.lat, userLocation.lon]}
                    radius={searchRadiusKm * 1000}
                    pathOptions={{ color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.08, weight: 2 }}
                  />
                ) : null}
                <RankedCandidateMarkers
                  candidates={candidates}
                  selectedCandidateId={selectedCandidateId}
                  routeFacilityId={routeFacilityId}
                  onSelectCandidate={onSelectCandidate}
                />
              </>
            ) : null}
            <ScoreLegend hasScores={meta?.hasV4Scores ?? false} hidden={hasCandidates} />
            {userLocation ? <UserLocationMarker lat={userLocation.lat} lon={userLocation.lon} /> : null}
            {hasCandidates ? (
              <MapFlyTo
                candidates={candidates}
                userLocation={userLocation}
                selectedCandidateId={selectedCandidateId}
                routeFacilityId={routeFacilityId}
              />
            ) : null}
            {activeMockRoute?.route_polyline ? (
              <Polyline positions={activeMockRoute.route_polyline} pathOptions={ROUTE_POLYLINE_OPTIONS} />
            ) : null}
            <MapClickHandler enabled={mapReady && locationPickMode} onMapClick={handleMapClick} />
          </MapContainer>
        )}
        {mockRouteLoading && !activeMockRoute ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-md">
            <div className="pointer-events-auto rounded-lg border border-neutral-200 bg-white/95 px-4 py-3 text-[11px] text-neutral-500 shadow-lg backdrop-blur-sm animate-pulse">
              Calculating simulated ETA…
            </div>
          </div>
        ) : null}
        {mockRouteError ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-md">
            <div className="pointer-events-auto rounded-lg border border-rose-200 bg-white/95 px-4 py-3 text-[11px] text-rose-700 shadow-lg backdrop-blur-sm">
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
      </div>
    </div>
  );
}
