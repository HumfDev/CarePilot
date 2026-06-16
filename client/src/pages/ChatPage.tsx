import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { IndiaMapPanel } from '../components/IndiaMapPanel';
import { RightChatPanel } from '../components/RightChatPanel';
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
    if (referral.userLocation && referral.candidates.length > 0) {
      setPlannerLocation({
        lat: referral.userLocation.lat,
        lon: referral.userLocation.lon,
      });
    }
  }, [referral.userLocation, referral.candidates.length]);

  useEffect(() => {
    mockRoute.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referral.scenarioId]);

  const routeFacilityId = mockRoute.activeFacilityId ?? mockRoute.route?.facility_id ?? null;

  const handleShowReferralRoute = useCallback(
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

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900">
      <main className="min-h-0 flex-1 bg-white">
        <PanelGroup direction="horizontal" className="h-full w-full">
          <Panel defaultSize={72} minSize={35}>
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
                  onSelectCandidate={referral.selectCandidate}
                  searchRadiusKm={referral.searchParams?.max_distance_km ?? null}
                />
              </Panel>
              {referral.candidates.length > 0 ? (
                <>
                  <PanelResizeHandle className="h-1 bg-neutral-200 transition-colors hover:bg-neutral-300" />
                  <Panel defaultSize={35} minSize={15}>
                    <div className="flex h-full min-h-0 flex-col bg-white">
                      <ReferralCandidateList
                        candidates={referral.candidates}
                        selectedCandidateId={referral.selectedCandidateId}
                        onSelect={referral.selectCandidate}
                        feedbackApplied={referral.feedbackApplied}
                        userLocation={userLocation}
                        routeFacilityId={routeFacilityId}
                        route={mockRoute.route}
                        routeLoading={mockRoute.loading}
                        onShowRoute={handleShowReferralRoute}
                        onClearRoute={mockRoute.clear}
                      />
                    </div>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="w-1 bg-neutral-200 transition-colors hover:bg-neutral-300" />
          <Panel defaultSize={28} minSize={22} className="min-h-0">
            <RightChatPanel referral={referral} />
          </Panel>
        </PanelGroup>
      </main>

      <ReferralCandidateCard
        candidate={referral.selectedCandidate}
        scenarioId={referral.scenarioId}
        careNeed={referral.searchParams?.care_need ?? null}
        careType={referral.searchParams?.care_type ?? null}
        summarizer={referral.summarizer}
        llamaModel={referral.llamaModel}
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
