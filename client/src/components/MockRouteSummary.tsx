import type { MockRoute, TrafficLevel } from '../types/route';

const TRAFFIC_TONE: Record<TrafficLevel, { dot: string; label: string; badge: string }> = {
  Light: { dot: 'bg-emerald-500', label: 'text-emerald-700', badge: 'bg-emerald-500/15 ring-emerald-500/30' },
  Moderate: { dot: 'bg-amber-500', label: 'text-amber-700', badge: 'bg-amber-500/15 ring-amber-500/30' },
  Heavy: { dot: 'bg-rose-500', label: 'text-rose-700', badge: 'bg-rose-500/15 ring-rose-500/30' },
};

interface MockRouteSummaryProps {
  route: MockRoute;
  onClear: () => void;
}

/** Route readout — map overlay above the referral map. */
export function MockRouteSummary({ route, onClear }: MockRouteSummaryProps) {
  const tone = TRAFFIC_TONE[route.traffic_level];
  const isOsrm = route.route_engine === 'osrm';
  const header = isOsrm ? 'Road network route · OSRM' : 'Simulated route · demo only';
  const showTrafficMock = !isOsrm && route.traffic_delay_minutes > 0.5;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white/90 px-4 py-3 text-[11px] text-neutral-700 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {header}
          </div>
          <div className="text-sm font-semibold text-neutral-900">{route.facility_name}</div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100"
        >
          Hide route
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-neutral-500">ETA</dt>
          <dd className="font-semibold text-neutral-900">{route.eta_minutes.toFixed(0)} min</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Distance</dt>
          <dd>{route.distance_km.toFixed(1)} km</dd>
        </div>
        {showTrafficMock ? (
          <>
            <div>
              <dt className="text-neutral-500">Traffic delay</dt>
              <dd>
                {route.traffic_delay_minutes > 0 ? '+' : ''}
                {route.traffic_delay_minutes.toFixed(0)} min
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Level</dt>
              <dd>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${tone.badge} ${tone.label}`}
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  {route.traffic_level}
                </span>
              </dd>
            </div>
          </>
        ) : (
          <div className="col-span-2">
            <dt className="text-neutral-500">Source</dt>
            <dd className="text-neutral-600">OpenStreetMap roads · not live traffic</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-[10px] leading-snug text-neutral-500">{route.disclaimer}</p>
    </div>
  );
}
