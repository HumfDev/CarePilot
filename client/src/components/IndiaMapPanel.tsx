import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import { useFacilities } from '../hooks/useFacilities';
import { findShortestPath } from '../lib/routing/findRoute';
import { isPointInIndia } from '../lib/routing/isInIndia';
import { snapToNearestFacility } from '../lib/routing/snapToFacility';
import type { RouteResult, SelectedPoint } from '../types/facility';

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];
const SNAP_RADIUS_KM = 50;

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

function FacilityMarkers({ facilities }: { facilities: { id: string; lat: number; lng: number; name: string }[] }) {
  return (
    <>
      {facilities.map((facility) => (
        <CircleMarker
          key={facility.id}
          center={[facility.lat, facility.lng]}
          radius={3}
          pathOptions={{ color: '#737373', fillColor: '#525252', fillOpacity: 0.7, weight: 1 }}
        >
          <Tooltip sticky>{facility.name}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

export function IndiaMapPanel() {
  const { facilities, facilitiesById, graph, loading, error } = useFacilities();
  const [indiaBoundary, setIndiaBoundary] = useState<FeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const [start, setStart] = useState<SelectedPoint | null>(null);
  const [end, setEnd] = useState<SelectedPoint | null>(null);
  const [selectionStep, setSelectionStep] = useState<'start' | 'end'>('start');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);

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
    [graph, facilitiesById],
  );

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!indiaBoundary || facilities.length === 0) return;

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
          `Start: ${snap.facility.name} (${snap.distanceKm.toFixed(1)} km from click). Click destination.`,
        );
        return;
      }

      setEnd(selected);
      setSelectionStep('start');
      const nextRoute = start ? computeRoute(start, selected) : null;
      setRoute(nextRoute);

      if (nextRoute) {
        setStatusMessage(
          `Route: ${nextRoute.path.length} facilities, ${nextRoute.distanceKm.toFixed(1)} km total.`,
        );
      } else {
        setStatusMessage(
          'No connected route between these facilities. Try closer points or increase edge radius.',
        );
      }
    },
    [indiaBoundary, facilities, selectionStep, start, computeRoute],
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
        : 'No connected route between these facilities.',
    );
  };

  const routePositions = useMemo(
    () => route?.path.map((node) => [node.lat, node.lng] as [number, number]) ?? [],
    [route],
  );

  const mapReady = !loading && !error && indiaBoundary && facilities.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950" data-testid="india-map-panel">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">India Healthcare Map</h2>
          <p className="text-xs text-neutral-500">
            Click twice to route between nearest facilities (Dijkstra)
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
        {!loading && !error && !statusMessage && selectionStep === 'start' && 'Click the map to select a start facility.'}
        {!loading && !error && !statusMessage && selectionStep === 'end' && 'Click the map to select a destination facility.'}
        {route && (
          <span className="ml-2 text-neutral-300">
            Distance: {route.distanceKm.toFixed(1)} km · Stops: {route.path.length}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {!mapReady ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            {loading ? 'Loading map data…' : 'Preparing map…'}
          </div>
        ) : (
          <MapContainer
            center={INDIA_CENTER}
            zoom={5}
            className="h-full w-full"
            scrollWheelZoom
          >
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
            <FacilityMarkers facilities={facilities} />
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
            <MapClickHandler enabled={mapReady} onMapClick={handleMapClick} />
          </MapContainer>
        )}
      </div>
    </div>
  );
}
