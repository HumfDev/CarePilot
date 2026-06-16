import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import { Search, X } from 'lucide-react';
import { useFacilities } from '../hooks/useFacilities';
import { calculateMatchScore, computeConditionScoreFromKeywords } from '../lib/scoring';
import { isPointInIndia } from '../lib/routing/isInIndia';
import { snapToNearestFacility } from '../lib/routing/snapToFacility';
import type { FacilityNode, SelectedPoint } from '../types/facility';

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];
const SNAP_RADIUS_KM = 50;
const SEARCH_RADIUS_KM = 80.4672;
const SEARCH_RADIUS_METERS = SEARCH_RADIUS_KM * 1000;

interface RankedFacility extends FacilityNode {
  distanceKm: number;
  score: number;
}

interface RouteStart {
  lat: number;
  lng: number;
}

interface CommuteResult {
  durationText: string;
  distanceText: string;
  durationSeconds: number;
  departureTime: string;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreTone(score: number) {
  if (score >= 80) return { color: '#22c55e', label: 'Strong match' };
  if (score >= 60) return { color: '#f59e0b', label: 'Good match' };
  return { color: '#ef4444', label: 'Lower match' };
}

function formatType(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'Healthcare facility';
}

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const meridiem = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${meridiem}`;
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

function SearchViewport({
  cityCenter,
  selectedFacility,
}: {
  cityCenter: [number, number] | null;
  selectedFacility: RankedFacility | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedFacility) {
      map.flyTo([selectedFacility.lat, selectedFacility.lng], Math.max(map.getZoom(), 11), { duration: 0.4 });
      return;
    }
    if (cityCenter) {
      map.flyTo(cityCenter, 9, { duration: 0.4 });
    }
  }, [cityCenter, map, selectedFacility]);

  return null;
}

function FacilityMarkers({
  facilities,
  selectedFacilityId,
  onSelect,
}: {
  facilities: RankedFacility[];
  selectedFacilityId: string | null;
  onSelect: (facility: RankedFacility) => void;
}) {
  return (
    <>
      {facilities.map((facility) => {
        const tone = scoreTone(facility.score);
        const selected = facility.id === selectedFacilityId;

        return (
          <CircleMarker
            key={facility.id}
            center={[facility.lat, facility.lng]}
            radius={selected ? 11 : 7}
            eventHandlers={{ click: () => onSelect(facility) }}
            pathOptions={{
              color: selected ? '#ffffff' : tone.color,
              fillColor: tone.color,
              fillOpacity: selected ? 1 : 0.82,
              weight: selected ? 3 : 2,
            }}
          >
            <Tooltip sticky>
              {facility.name} &mdash; {facility.score} match
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function IndiaMapPanel() {
  const { facilities, loading, error } = useFacilities();
  const [indiaBoundary, setIndiaBoundary] = useState<FeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [requestQuery, setRequestQuery] = useState('');
  const [searchedCity, setSearchedCity] = useState('');
  const [cityCenter, setCityCenter] = useState<[number, number] | null>(null);
  const [rankedFacilities, setRankedFacilities] = useState<RankedFacility[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<RankedFacility | null>(null);
  const [searchMessage, setSearchMessage] = useState('Enter a city and healthcare need to find nearby options.');
  const [resolving, setResolving] = useState(false);

  // Routing state
  const [routeStart, setRouteStart] = useState<RouteStart | null>(null);
  const [routeEnd, setRouteEnd] = useState<SelectedPoint | null>(null);
  const [selectionStep, setSelectionStep] = useState<'start' | 'end' | 'time'>('start');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [departureTime, setDepartureTime] = useState('');
  const [commuteResult, setCommuteResult] = useState<CommuteResult | null>(null);
  const [commuteLoading, setCommuteLoading] = useState(false);

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

  const cityCenters = useMemo(() => {
    const groups = new Map<string, { label: string; latTotal: number; lngTotal: number; count: number }>();

    facilities.forEach((facility) => {
      if (!facility.city) return;
      const key = normalize(facility.city);
      const existing = groups.get(key);
      if (existing) {
        existing.latTotal += facility.lat;
        existing.lngTotal += facility.lng;
        existing.count += 1;
        return;
      }
      groups.set(key, { label: facility.city, latTotal: facility.lat, lngTotal: facility.lng, count: 1 });
    });

    return new Map(
      [...groups.entries()].map(([key, value]) => [
        key,
        {
          label: value.label,
          center: [value.latTotal / value.count, value.lngTotal / value.count] as [number, number],
        },
      ]),
    );
  }, [facilities]);

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cityKey = normalize(cityQuery);
    const city = cityCenters.get(cityKey);
    if (!city) {
      const examples = [...cityCenters.values()].slice(0, 5).map((item) => item.label).join(', ');
      setRankedFacilities([]);
      setSelectedFacility(null);
      setCityCenter(null);
      setSearchedCity(cityQuery.trim());
      setSearchMessage(`City not found. Try: ${examples || 'a city from the dataset'}.`);
      return;
    }

    let llmKeywords: string[] | null = null;
    let llmCareType: string | null = null;
    let llmLabel: string | null = null;

    if (requestQuery.trim()) {
      setResolving(true);
      try {
        const resp = await fetch('/api/map/resolve-condition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: requestQuery }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { keywords: string[]; careType: string; label: string };
          llmKeywords = data.keywords;
          llmCareType = data.careType;
          llmLabel = data.label;
        }
      } catch {
        // fall through to rule-based
      } finally {
        setResolving(false);
      }
    }

    const ranked = facilities
      .map((facility) => {
        const distanceKm = haversineKm(city.center[0], city.center[1], facility.lat, facility.lng);
        let score: number;
        if (llmKeywords && llmCareType) {
          const { score: baseScore } = calculateMatchScore(facility, llmCareType, distanceKm);
          const condScore = computeConditionScoreFromKeywords(facility, llmKeywords);
          score = Math.round(Math.min(100, baseScore * 0.6 + condScore * 0.4));
        } else {
          ({ score } = calculateMatchScore(facility, requestQuery, distanceKm));
        }
        return { ...facility, distanceKm, score };
      })
      .filter((facility) => facility.distanceKm <= SEARCH_RADIUS_KM)
      .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

    setCityCenter(city.center);
    setSearchedCity(city.label);
    setRankedFacilities(ranked);
    setSelectedFacility(ranked[0] ?? null);
    const conditionNote = llmLabel ? ` · ${llmLabel}` : '';
    setSearchMessage(`${ranked.length} facilities within 50 miles of ${city.label}${conditionNote}.`);
  };

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!indiaBoundary || facilities.length === 0) return;

      if (!isPointInIndia(lat, lng, indiaBoundary)) {
        setStatusMessage('Click must be inside India.');
        return;
      }

      if (selectionStep === 'start') {
        setRouteStart({ lat, lng });
        setRouteEnd(null);
        setCommuteResult(null);
        setSelectionStep('end');
        setStatusMessage('Start set. Now click anywhere near a facility as your destination.');
        return;
      }

      if (selectionStep === 'end') {
        const snap = snapToNearestFacility(lat, lng, facilities, SNAP_RADIUS_KM);
        if (!snap) {
          setStatusMessage(`No facility within ${SNAP_RADIUS_KM} km. Try clicking closer to a facility dot.`);
          return;
        }
        const selected: SelectedPoint = {
          facility: snap.facility,
          clickLat: lat,
          clickLng: lng,
          snapDistanceKm: snap.distanceKm,
        };
        setRouteEnd(selected);
        setSelectionStep('time');
        setShowTimeModal(true);
        setStatusMessage(`Destination: ${snap.facility.name}. Enter departure time.`);
      }
    },
    [indiaBoundary, facilities, selectionStep],
  );

  const fetchCommuteTime = useCallback(
    async (time: string) => {
      if (!routeStart || !routeEnd) return;
      setShowTimeModal(false);
      setCommuteLoading(true);
      try {
        const resp = await fetch('/api/map/commute-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originLat: routeStart.lat,
            originLng: routeStart.lng,
            destLat: routeEnd.facility.lat,
            destLng: routeEnd.facility.lng,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { durationText: string; distanceText: string; durationSeconds: number };
          setCommuteResult({ ...data, departureTime: time });
          setStatusMessage(
            `${formatTime12h(time)} → ${routeEnd.facility.name}: ${data.durationText} by road (${data.distanceText})`,
          );
        } else {
          const err = (await resp.json()) as { error: string };
          setStatusMessage(`Routing failed: ${err.error}`);
        }
      } catch {
        setStatusMessage('Failed to get commute time. Check network.');
      } finally {
        setCommuteLoading(false);
        setSelectionStep('start');
      }
    },
    [routeStart, routeEnd],
  );

  const clearRoute = () => {
    setRouteStart(null);
    setRouteEnd(null);
    setCommuteResult(null);
    setShowTimeModal(false);
    setDepartureTime('');
    setSelectionStep('start');
    setStatusMessage(null);
  };

  const routeLine = useMemo<[number, number][]>(() => {
    if (!routeStart || !routeEnd) return [];
    return [
      [routeStart.lat, routeStart.lng],
      [routeEnd.facility.lat, routeEnd.facility.lng],
    ];
  }, [routeStart, routeEnd]);

  const mapReady = !loading && !error && indiaBoundary && facilities.length > 0;

  return (
    <div className="flex h-full min-h-0" data-testid="india-map-panel">
      {/* Left column — search + route planner + results */}
      <div className="flex w-1/3 min-w-0 flex-col border-r border-neutral-800 bg-neutral-950">
        {/* Search form */}
        <div className="shrink-0 border-b border-neutral-800 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">CarePilot Facility Map</h2>
              <p className="mt-0.5 text-xs text-neutral-500">Search a city to find nearby facilities.</p>
            </div>
            <button
              type="button"
              onClick={clearRoute}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-700 px-2 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>

          <form onSubmit={handleSearch} className="grid gap-2">
            <input
              value={cityQuery}
              onChange={(event) => setCityQuery(event.target.value)}
              placeholder="City, e.g. Kolkata"
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm text-white outline-none ring-blue-500/30 placeholder:text-neutral-500 focus:ring-2"
            />
            <input
              value={requestQuery}
              onChange={(event) => setRequestQuery(event.target.value)}
              placeholder="Symptom or request"
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm text-white outline-none ring-blue-500/30 placeholder:text-neutral-500 focus:ring-2"
            />
            <button
              type="submit"
              disabled={loading || resolving || !cityQuery.trim()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
              {resolving ? 'Analyzing...' : 'Search'}
            </button>
          </form>

          <div className="mt-2 space-y-1 text-xs text-neutral-400">
            {loading && <span>Loading facilities...</span>}
            {error && <span>Error: {error}</span>}
            {boundaryError && <span>Boundary: {boundaryError}</span>}
            {!loading && !error && <span>{searchMessage}</span>}
          </div>
        </div>

        {/* Route planner */}
        <div className="shrink-0 border-b border-neutral-800 px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-neutral-400">Route planner</p>
          <p className="text-xs text-neutral-500">
            {selectionStep === 'start' && 'Click any point on the map to set your start.'}
            {selectionStep === 'end' && 'Click near a facility to set your destination.'}
            {selectionStep === 'time' && 'Enter departure time in the dialog.'}
          </p>
          {statusMessage && <p className="mt-1.5 text-xs text-neutral-300">{statusMessage}</p>}
          {commuteLoading && <p className="mt-1.5 text-xs text-blue-400">Calculating route...</p>}
          {commuteResult && (
            <div className="mt-2 rounded-md border border-neutral-700 bg-neutral-900 p-2.5">
              <p className="text-xs text-neutral-400">Departing {formatTime12h(commuteResult.departureTime)}</p>
              <p className="mt-0.5 text-sm font-bold text-white">{commuteResult.durationText}</p>
              <p className="text-xs text-neutral-500">
                {commuteResult.distanceText} by road · {routeEnd?.facility.name}
              </p>
            </div>
          )}
        </div>

        {/* Facility results list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>Best nearby options</span>
            <span>Radius: 50 mi</span>
          </div>

          {rankedFacilities.length === 0 ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-900/70 p-3 text-sm text-neutral-500">
              Search results will appear here.
            </div>
          ) : (
            <div className="grid gap-2">
              {rankedFacilities.map((facility) => {
                const tone = scoreTone(facility.score);
                const selected = selectedFacility?.id === facility.id;

                return (
                  <button
                    key={facility.id}
                    type="button"
                    onClick={() => setSelectedFacility(facility)}
                    className={`rounded-md border p-3 text-left transition ${
                      selected
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-neutral-800 bg-neutral-900/70 hover:border-neutral-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-white">{facility.name}</h3>
                        <p className="mt-0.5 truncate text-xs capitalize text-neutral-500">
                          {formatType(facility.facilityTypeId)} &middot;{' '}
                          {(facility.distanceKm * 0.621371).toFixed(1)} mi
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-white"
                        style={{ backgroundColor: tone.color }}
                      >
                        {facility.score}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-neutral-400">
                      {facility.specialties || facility.capability || facility.description || 'Facility details unavailable.'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right column — map */}
      <div className="relative min-h-0 flex-1">
        {!mapReady ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            {loading ? 'Loading map data...' : 'Preparing map...'}
          </div>
        ) : (
          <MapContainer
            center={INDIA_CENTER}
            zoom={5}
            className="h-full w-full"
            scrollWheelZoom
            touchZoom
            dragging
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <GeoJSON
              data={indiaBoundary}
              style={{ color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.05 }}
            />
            {cityCenter && (
              <Circle
                center={cityCenter}
                radius={SEARCH_RADIUS_METERS}
                pathOptions={{ color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.08, weight: 2 }}
              />
            )}
            <FacilityMarkers
              facilities={rankedFacilities}
              selectedFacilityId={selectedFacility?.id ?? null}
              onSelect={setSelectedFacility}
            />
            {routeStart && (
              <CircleMarker
                center={[routeStart.lat, routeStart.lng]}
                radius={8}
                pathOptions={{ color: '#32D74B', fillColor: '#32D74B', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  Start
                </Tooltip>
              </CircleMarker>
            )}
            {routeEnd && (
              <CircleMarker
                center={[routeEnd.facility.lat, routeEnd.facility.lng]}
                radius={8}
                pathOptions={{ color: '#FF453A', fillColor: '#FF453A', fillOpacity: 0.9, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  {routeEnd.facility.name}
                </Tooltip>
              </CircleMarker>
            )}
            {routeLine.length === 2 && (
              <Polyline
                positions={routeLine}
                pathOptions={{ color: '#007AFF', weight: 3, opacity: 0.7, dashArray: '8 6' }}
              />
            )}
            <MapClickHandler enabled={Boolean(mapReady)} onMapClick={handleMapClick} />
            <SearchViewport cityCenter={cityCenter} selectedFacility={selectedFacility} />
          </MapContainer>
        )}

        {/* Facility detail popup */}
        {selectedFacility && (
          <article className="absolute bottom-4 right-4 z-[500] w-72 rounded-md border border-neutral-800 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-white">{selectedFacility.name}</h3>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {[selectedFacility.city, selectedFacility.state].filter(Boolean).join(', ') || searchedCity}
                </p>
              </div>
              <span
                className="shrink-0 rounded px-2 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: scoreTone(selectedFacility.score).color }}
              >
                {selectedFacility.score}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
              <div className="rounded border border-neutral-800 p-1.5">
                <span className="text-neutral-500">Distance</span>
                <strong className="block text-white">{(selectedFacility.distanceKm * 0.621371).toFixed(1)} mi</strong>
              </div>
              <div className="rounded border border-neutral-800 p-1.5">
                <span className="text-neutral-500">Doctors</span>
                <strong className="block text-white">{selectedFacility.numberDoctors || 'N/A'}</strong>
              </div>
              <div className="rounded border border-neutral-800 p-1.5">
                <span className="text-neutral-500">Capacity</span>
                <strong className="block text-white">{selectedFacility.capacity || 'N/A'}</strong>
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-xs text-neutral-300">
              {selectedFacility.description || 'No description available.'}
            </p>
          </article>
        )}

        {/* Departure time modal */}
        {showTimeModal && routeEnd && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/60">
            <div className="w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
              <h3 className="mb-0.5 text-sm font-semibold text-white">When are you leaving?</h3>
              <p className="mb-4 text-xs text-neutral-400">To: {routeEnd.facility.name}</p>
              <input
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="mb-4 h-10 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/30"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTimeModal(false);
                    setRouteEnd(null);
                    setSelectionStep('end');
                    setStatusMessage('Destination cleared. Click near a facility to try again.');
                  }}
                  className="flex-1 rounded-md border border-neutral-700 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!departureTime}
                  onClick={() => fetchCommuteTime(departureTime)}
                  className="flex-1 rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Get commute time
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
