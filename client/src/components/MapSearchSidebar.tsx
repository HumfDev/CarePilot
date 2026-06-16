/**
 * Left sidebar — same referral search as chat (parse + Python pipeline).
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, Clock, MapPin, Search, X } from 'lucide-react';
import type { ReferralCandidate } from '../types/referral';
import type { MockRoute } from '../types/route';
import type { PlannerLocation } from './PlannerLocationControl';
import { ReferralCandidateList } from './ReferralCandidateList';
import { formatCoord, randomIndiaLocation } from '../lib/randomIndiaLocation';

interface CommutePreview {
  facilityName: string;
  departureTime: string;
  durationText: string;
  distanceText: string;
}

interface MapSearchSidebarProps {
  boundaryError: string | null;
  plannerLocation: PlannerLocation | null;
  onPlannerLocationChange: (location: PlannerLocation | null) => void;
  onPickModeChange: (active: boolean) => void;
  pickMode: boolean;
  candidates: ReferralCandidate[];
  selectedCandidateId: string | null;
  onSelectCandidate: (id: string) => void;
  feedbackApplied?: boolean;
  careNeedHint?: string | null;
  locationHint?: string | null;
  searchLoading: boolean;
  searchError: string | null;
  onSearch: (input: { city: string; careNeed: string }) => Promise<void>;
  onClear: () => void;
  userLocation?: { lat: number; lon: number } | null;
  routeFacilityId?: string | null;
  route?: MockRoute | null;
  routeLoading?: boolean;
  onShowRoute: (candidate: ReferralCandidate) => void;
  onClearRoute?: () => void;
}

function defaultDepartureTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;
  const meridiem = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${meridiem}`;
}

export function MapSearchSidebar({
  boundaryError,
  plannerLocation,
  onPlannerLocationChange,
  onPickModeChange,
  pickMode,
  candidates,
  selectedCandidateId,
  onSelectCandidate,
  feedbackApplied,
  careNeedHint,
  locationHint,
  searchLoading,
  searchError,
  onSearch,
  onClear,
  userLocation,
  routeFacilityId = null,
  route = null,
  routeLoading = false,
  onShowRoute,
  onClearRoute,
}: MapSearchSidebarProps) {
  const [cityQuery, setCityQuery] = useState(locationHint ?? '');
  const [requestQuery, setRequestQuery] = useState(careNeedHint ?? '');
  const [departureTime, setDepartureTime] = useState(defaultDepartureTime);
  const [commutePreview, setCommutePreview] = useState<CommutePreview | null>(null);
  const [formCollapsed, setFormCollapsed] = useState(false);

  useEffect(() => {
    if (locationHint) setCityQuery(locationHint);
  }, [locationHint]);

  useEffect(() => {
    if (careNeedHint) setRequestQuery(careNeedHint);
  }, [careNeedHint]);

  useEffect(() => {
    if (route?.facility_name && route.eta_minutes != null) {
      setCommutePreview({
        facilityName: route.facility_name,
        departureTime,
        durationText: `${Math.round(route.eta_minutes)} min`,
        distanceText: `${route.distance_km.toFixed(1)} km`,
      });
    }
  }, [route, departureTime]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSearch({ city: cityQuery, careNeed: requestQuery });
  };

  const handleClear = () => {
    setCityQuery('');
    setRequestQuery('');
    setCommutePreview(null);
    onClearRoute?.();
    onClear();
  };

  const busy = searchLoading;
  const canSearch = cityQuery.trim().length > 0 && !busy;
  const collapseForm = () => {
    onPickModeChange(false);
    setFormCollapsed(true);
  };

  return (
    <div
      className="flex w-[min(22rem,38vw)] shrink-0 flex-col border-r border-neutral-200 bg-white"
      data-testid="map-search-sidebar"
    >
      <div className={`shrink-0 border-b border-neutral-200 ${formCollapsed ? 'px-4 py-3' : 'px-4 py-4'}`}>
        <div className={`flex items-start justify-between gap-2 ${formCollapsed ? '' : 'mb-3'}`}>
          <div className="flex items-center gap-2">
            <img src="/brand/carepilot-icon.png" alt="" aria-hidden className="h-6 w-6 object-contain" />
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">Plan your trip</h2>
              {!formCollapsed ? (
                <p className="text-[11px] text-neutral-500">Same search as chat · evidence-ranked</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {formCollapsed ? (
              <button
                type="button"
                onClick={() => setFormCollapsed(false)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50"
                title="Show search form"
                aria-label="Show search form"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Search
              </button>
            ) : (
              <button
                type="button"
                onClick={collapseForm}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50"
                title="Hide search form"
                aria-label="Hide search form"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Hide
              </button>
            )}
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

        {formCollapsed && candidates.length > 0 ? (
          <div className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2">
            <p className="text-sm font-semibold text-neutral-900">
              Ranked results · {candidates.length}
            </p>
            <p className="mt-0.5 text-xs text-neutral-600">
              {locationHint ? `Near ${locationHint}` : 'Nearby'}
              {careNeedHint ? ` · ${careNeedHint}` : ''}
            </p>
          </div>
        ) : null}

        {!formCollapsed ? (
        <form onSubmit={handleSubmit} className="grid gap-2">
          <input
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            placeholder="City, e.g. Jaipur"
            className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={requestQuery}
            onChange={(e) => setRequestQuery(e.target.value)}
            placeholder="Care need, e.g. dialysis"
            className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <label className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2">
            <Clock className="h-4 w-4 shrink-0 text-neutral-400" />
            <span className="text-[11px] text-neutral-500">Leave at</span>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className="ml-auto text-sm text-neutral-900 outline-none"
            />
          </label>

          <div className="rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
                <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                My location (route origin)
              </div>
              {plannerLocation ? (
                <button
                  type="button"
                  onClick={() => onPlannerLocationChange(null)}
                  className="text-[10px] text-neutral-500 hover:text-neutral-700"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-neutral-700">
              {plannerLocation
                ? `${formatCoord(plannerLocation.lat)}, ${formatCoord(plannerLocation.lon)}`
                : 'Optional — overrides distance origin after search'}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onPlannerLocationChange(randomIndiaLocation());
                  onPickModeChange(false);
                }}
                className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-500"
              >
                Random demo
              </button>
              <button
                type="button"
                onClick={() => onPickModeChange(!pickMode)}
                className={`rounded-md border px-2 py-1 text-[10px] font-medium ${
                  pickMode
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-neutral-200 text-neutral-700 hover:bg-white'
                }`}
              >
                {pickMode ? 'Click map…' : 'Pick on map'}
              </button>
            </div>
            {pickMode ? (
              <p className="mt-1.5 text-[10px] text-indigo-700">Click inside India on the map.</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!canSearch}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>
        ) : null}

        {!formCollapsed ? (
          <div className="mt-2 space-y-1 text-xs text-neutral-500">
            {boundaryError && <span className="text-rose-600">{boundaryError}</span>}
            {searchError && <span className="text-rose-600">{searchError}</span>}
            {!busy && candidates.length === 0 ? (
              <span>Search here or use chat — same results.</span>
            ) : null}
          </div>
        ) : null}

        {commutePreview && !formCollapsed ? (
          <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-2.5">
            <p className="text-[10px] text-indigo-700">
              Departing {formatTime12h(commutePreview.departureTime)} → {commutePreview.facilityName}
            </p>
            <p className="text-sm font-bold text-neutral-900">{commutePreview.durationText} by road</p>
            <p className="text-[11px] text-neutral-600">{commutePreview.distanceText} · OSRM estimate</p>
          </div>
        ) : null}

        {formCollapsed && (boundaryError || searchError) ? (
          <div className="mt-2 space-y-1 text-xs text-rose-600">
            {boundaryError}
            {searchError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {candidates.length > 0 ? (
          <ReferralCandidateList
            embedded
            hideHeader={formCollapsed}
            candidates={candidates}
            selectedCandidateId={selectedCandidateId}
            onSelect={onSelectCandidate}
            feedbackApplied={feedbackApplied}
            userLocation={userLocation}
            routeFacilityId={routeFacilityId}
            route={route ?? null}
            routeLoading={routeLoading}
            onShowRoute={onShowRoute}
            onClearRoute={onClearRoute ?? (() => {})}
            departureTime={departureTime}
          />
        ) : (
          <div className="p-3 text-sm text-neutral-500">
            {busy
              ? 'Running evidence search…'
              : 'Results appear here after search — sidebar and chat use the same ranking.'}
          </div>
        )}
      </div>
    </div>
  );
}
