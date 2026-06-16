import { useState } from 'react';
import { formatCoord, randomIndiaLocation } from '../lib/randomIndiaLocation';

export interface PlannerLocation {
  lat: number;
  lon: number;
}

interface PlannerLocationControlProps {
  location: PlannerLocation | null;
  onChange: (location: PlannerLocation | null) => void;
  pickMode: boolean;
  onPickModeChange: (active: boolean) => void;
}

function parseCoord(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

export function PlannerLocationControl({
  location,
  onChange,
  pickMode,
  onPickModeChange,
}: PlannerLocationControlProps) {
  const [open, setOpen] = useState(() => location == null);
  const [latInput, setLatInput] = useState(location ? formatCoord(location.lat) : '');
  const [lonInput, setLonInput] = useState(location ? formatCoord(location.lon) : '');
  const [inputError, setInputError] = useState<string | null>(null);
  const panelKey = location ? `${location.lat}-${location.lon}` : 'empty';

  function applyManual() {
    const lat = parseCoord(latInput);
    const lon = parseCoord(lonInput);
    if (lat == null || lon == null) {
      setInputError('Enter valid latitude and longitude.');
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setInputError('Coordinates are out of range.');
      return;
    }
    setInputError(null);
    onChange({ lat, lon });
    onPickModeChange(false);
    setOpen(false);
  }

  function setRandomLocation() {
    const next = randomIndiaLocation();
    setLatInput(formatCoord(next.lat));
    setLonInput(formatCoord(next.lon));
    setInputError(null);
    onChange(next);
    onPickModeChange(false);
    setOpen(false);
  }

  function startPickOnMap() {
    setInputError(null);
    onPickModeChange(true);
    setOpen(true);
  }

  if (!open) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-neutral-950/90 px-3 py-2 text-xs font-medium text-indigo-100 shadow-lg backdrop-blur-sm hover:bg-indigo-500/10"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/20 text-[10px]">
            ◉
          </span>
          {location ? `My location · ${formatCoord(location.lat)}, ${formatCoord(location.lon)}` : 'Set my location'}
        </button>
      </div>
    );
  }

  return (
    <div
      key={panelKey}
      className="pointer-events-none absolute bottom-3 left-3 z-[1000] w-[min(20rem,calc(100vw-2rem))]"
    >
      <div className="pointer-events-auto rounded-lg border border-indigo-500/30 bg-neutral-950/92 px-3 py-3 text-[11px] text-neutral-200 shadow-lg backdrop-blur-sm">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">My location</div>
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
              Demo only — used as the route origin. Not your device GPS.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onPickModeChange(false);
              setOpen(false);
            }}
            className="rounded-md border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={setRandomLocation}
            className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            My location (random demo)
          </button>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-neutral-500">Latitude</span>
              <input
                type="text"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                placeholder="e.g. 26.9124"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white placeholder:text-neutral-600 focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-neutral-500">Longitude</span>
              <input
                type="text"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                placeholder="e.g. 75.7873"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white placeholder:text-neutral-600 focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>

          {inputError ? <p className="text-[10px] text-rose-300">{inputError}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyManual}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Apply coordinates
            </button>
            <button
              type="button"
              onClick={startPickOnMap}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                pickMode
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200'
                  : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
              }`}
            >
              {pickMode ? 'Click map…' : 'Pick on map'}
            </button>
            {location ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  onPickModeChange(false);
                  setLatInput('');
                  setLonInput('');
                  setInputError(null);
                }}
                className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-900"
              >
                Clear
              </button>
            ) : null}
          </div>

          {pickMode ? (
            <p className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-2 py-1.5 text-[10px] text-indigo-200">
              Click anywhere inside India on the map to set your location.
            </p>
          ) : null}

          {location ? (
            <p className="text-[10px] text-neutral-500">
              Current: {formatCoord(location.lat)}, {formatCoord(location.lon)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
