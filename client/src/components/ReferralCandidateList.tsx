/**
 * Compact ranked list of referral candidates.
 *
 * Phase 1: lives inside the left (map) panel under the map.
 * Phase 2: graduates to its own column in the `List | Map | Chat` layout.
 *
 * Rendering rules:
 *   - rank, name, distance, score, evidence-strength, uncertainty
 *   - warning icon when suspicious_evidence_flags are present
 *   - short recommendation_reason snippet
 *   - selected row mirrors the map marker / open card
 */
import type { ReferralCandidate } from '../types/referral';
import type { MockRoute } from '../types/route';

interface ReferralCandidateListProps {
  candidates: ReferralCandidate[];
  selectedCandidateId: string | null;
  onSelect: (candidateId: string) => void;
  feedbackApplied?: boolean;
  userLocation?: { lat: number; lon: number } | null;
  routeFacilityId: string | null;
  route: MockRoute | null;
  routeLoading: boolean;
  onShowRoute: (candidate: ReferralCandidate) => void;
  onClearRoute: () => void;
}

function uncertaintyTone(level: string | null): { dot: string; label: string } {
  const text = (level ?? '').toLowerCase();
  if (text.startsWith('low')) return { dot: 'bg-emerald-500', label: 'text-emerald-700' };
  if (text.startsWith('medium')) return { dot: 'bg-amber-500', label: 'text-amber-700' };
  if (text.startsWith('high')) return { dot: 'bg-rose-500', label: 'text-rose-700' };
  return { dot: 'bg-neutral-500', label: 'text-neutral-400' };
}

function compactReason(reason: string | null, maxLen = 130): string {
  if (!reason) return 'Evidence summary not available — verify before referral.';
  return reason.length > maxLen ? `${reason.slice(0, maxLen).trim()}…` : reason;
}

export function ReferralCandidateList({
  candidates,
  selectedCandidateId,
  onSelect,
  feedbackApplied,
  userLocation,
  routeFacilityId,
  route,
  routeLoading,
  onShowRoute,
  onClearRoute,
}: ReferralCandidateListProps) {
  if (!candidates.length) {
    return (
      <div className="flex flex-col gap-1 px-4 py-3 text-xs text-neutral-500">
        <span className="font-semibold uppercase tracking-wide text-neutral-400">Ranked candidates</span>
        <span>Ask the chat for a referral — e.g. &ldquo;dialysis near Jaipur&rdquo;.</span>
      </div>
    );
  }

  const canRoute = userLocation != null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="referral-candidate-list">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-700">
          Ranked candidates · {candidates.length}
        </span>
        {feedbackApplied ? (
          <span className="rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            Feedback re-rank active
          </span>
        ) : null}
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto">
        {candidates.map((candidate) => {
          const isSelected = candidate.facility_id === selectedCandidateId;
          const score = candidate.feedback_adjusted_score ?? candidate.final_recommendation_score ?? 0;
          const evidence = candidate.evidence_strength_score ?? 0;
          const distance = candidate.distance_km ?? 0;
          const tone = uncertaintyTone(candidate.uncertainty_level);
          const hasSuspicious = (candidate.suspicious_evidence_flags?.length ?? 0) > 0;
          const hasMissing = (candidate.missing_evidence_flags?.length ?? 0) > 0;
          const feedbackDelta = candidate.feedback_delta ?? 0;

          const isRouteActive = routeFacilityId === candidate.facility_id && route != null;
          const isRouteLoading = routeLoading && routeFacilityId === candidate.facility_id;

          return (
            <li key={candidate.facility_id}>
              <div
                className={`flex items-stretch gap-1 px-2 py-1 transition-colors ${
                  isSelected ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/40' : 'hover:bg-neutral-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(candidate.facility_id)}
                  className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-1 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-700">
                        {candidate.rank}
                      </span>
                      <span className="truncate text-sm font-medium text-neutral-900">{candidate.facility_name}</span>
                      {hasSuspicious ? (
                        <span
                          className="shrink-0 rounded-md bg-rose-500/15 px-1 text-[10px] font-medium text-rose-700"
                          title={candidate.suspicious_evidence_flags?.join(', ')}
                        >
                          ⚠ suspicious
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-neutral-900">{score.toFixed(1)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                    <span>{distance.toFixed(1)} km</span>
                    <span className={tone.label}>
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {candidate.uncertainty_level ?? 'uncertainty n/a'}
                    </span>
                    <span>evidence {evidence}</span>
                    {feedbackDelta !== 0 ? (
                      <span className={feedbackDelta > 0 ? 'text-emerald-700' : 'text-rose-700'}>
                        {feedbackDelta > 0 ? '+' : ''}
                        {feedbackDelta.toFixed(1)} feedback
                      </span>
                    ) : null}
                    {hasMissing ? <span className="text-neutral-500">missing fields</span> : null}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-snug text-neutral-400">
                    {compactReason(candidate.recommendation_reason)}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={!canRoute || candidate.latitude == null || candidate.longitude == null || isRouteLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isRouteActive) onClearRoute();
                    else onShowRoute(candidate);
                  }}
                  className={`my-1 shrink-0 self-center rounded-md px-2.5 py-1.5 text-[10px] font-medium ${
                    isRouteActive
                      ? 'bg-blue-600 text-white ring-1 ring-blue-400/50'
                      : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-100'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {isRouteLoading ? '…' : isRouteActive ? 'Route on' : 'Route'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
