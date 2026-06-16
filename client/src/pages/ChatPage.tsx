import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { IndiaMapPanel } from '../components/IndiaMapPanel';
import { ReferralChatPanel } from '../components/ReferralChatPanel';
import { ReferralCandidateList } from '../components/ReferralCandidateList';
import { ReferralCandidateCard } from '../components/ReferralCandidateCard';
import { useReferralSearch } from '../hooks/useReferralSearch';
import { useMockRoute } from '../hooks/useMockRoute';
import type { ReferralCandidate } from '../types/referral';
import type { PlannerLocation } from '../components/PlannerLocationControl';

export function ChatPage() {
  const referral = useReferralSearch();
  const mockRoute = useMockRoute();
  const [plannerLocation, setPlannerLocation] = useState<PlannerLocation | null>(null);

  const userLocation = useMemo(
    () => plannerLocation ?? referral.userLocation,
    [plannerLocation, referral.userLocation],
  );

  useEffect(() => {
    mockRoute.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referral.scenarioId]);

  const handleShowRoute = useCallback(
    (candidate: ReferralCandidate) => {
      if (!userLocation) return;
      if (candidate.latitude == null || candidate.longitude == null) return;
      referral.clearSelection();
      void mockRoute.fetchRoute({
        origin: { lat: userLocation.lat, lon: userLocation.lon },
        destination: { lat: candidate.latitude, lon: candidate.longitude },
        facility_id: candidate.facility_id,
        facility_name: candidate.facility_name,
      });
    },
    [mockRoute, referral, userLocation],
  );

  const routeFacilityId = mockRoute.activeFacilityId ?? mockRoute.route?.facility_id ?? null;

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-black px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
          <span className="text-sm font-medium text-white">CarePilot Referral Copilot</span>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          Evidence-aware · Planner-facing · Not medical advice
        </span>
      </header>

      <main className="min-h-0 flex-1 bg-black">
        <PanelGroup direction="horizontal" className="h-full w-full">
          <Panel defaultSize={62} minSize={35}>
            {/* Phase 1: map on top, compact ranked list inside the same left panel. */}
            <PanelGroup direction="vertical" className="h-full w-full">
              <Panel defaultSize={referral.candidates.length ? 65 : 100} minSize={40}>
                <IndiaMapPanel
                  candidates={referral.candidates}
                  selectedCandidateId={referral.selectedCandidateId}
                  routeFacilityId={routeFacilityId}
                  userLocation={userLocation}
                  plannerLocation={plannerLocation}
                  onPlannerLocationChange={setPlannerLocation}
                  activeMockRoute={mockRoute.route}
                  mockRouteLoading={mockRoute.loading}
                  mockRouteError={mockRoute.error}
                  onClearMockRoute={mockRoute.clear}
                />
              </Panel>
              {referral.candidates.length > 0 ? (
                <>
                  <PanelResizeHandle className="h-1 bg-neutral-800 transition-colors hover:bg-neutral-600" />
                  <Panel defaultSize={35} minSize={15}>
                    <div className="flex h-full min-h-0 flex-col bg-neutral-950">
                      <ReferralCandidateList
                        candidates={referral.candidates}
                        selectedCandidateId={referral.selectedCandidateId}
                        onSelect={referral.selectCandidate}
                        feedbackApplied={referral.feedbackApplied}
                        userLocation={userLocation}
                        routeFacilityId={routeFacilityId}
                        route={mockRoute.route}
                        routeLoading={mockRoute.loading}
                        onShowRoute={handleShowRoute}
                        onClearRoute={mockRoute.clear}
                      />
                    </div>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="w-1 bg-neutral-800 transition-colors hover:bg-neutral-600" />
          <Panel defaultSize={38} minSize={25}>
            <ReferralChatPanel referral={referral} />
          </Panel>
        </PanelGroup>
      </main>

      <ReferralCandidateCard
        candidate={referral.selectedCandidate}
        scenarioId={referral.scenarioId}
        careNeed={referral.searchParams?.care_need ?? null}
        careType={referral.searchParams?.care_type ?? null}
        onClose={referral.clearSelection}
        onShortlist={referral.saveShortlist}
        onSaveNote={referral.saveNote}
        onReview={referral.setReview}
        onOverride={referral.setOverride}
        actionPending={referral.actionPending}
      />
    </div>
  );
}
