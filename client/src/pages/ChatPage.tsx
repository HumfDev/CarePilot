import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { IndiaMapPanel } from '../components/IndiaMapPanel';
import { RightChatPanel } from '../components/RightChatPanel';
import { ReferralCandidateCard } from '../components/ReferralCandidateCard';
import { AppBrand } from '../components/AppBrand';
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

  const handleSidebarSearch = useCallback(
    async (input: { city: string; careNeed: string }) => {
      await referral.searchFromSidebar({
        city: input.city,
        careNeed: input.careNeed,
        plannerLocation,
      });
    },
    [referral, plannerLocation],
  );

  const handleClearSearch = useCallback(() => {
    referral.clearSearch();
    mockRoute.clear();
  }, [referral, mockRoute]);

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-neutral-900">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-4 py-2.5 shadow-sm sm:px-6">
        <AppBrand variant="header" />
        <span className="hidden text-[10px] font-medium uppercase tracking-widest text-neutral-500 md:inline">
          Evidence-aware · Planner-facing · Not medical advice
        </span>
      </header>

      <main className="min-h-0 flex-1 bg-slate-50">
        <PanelGroup direction="horizontal" className="h-full w-full">
          <Panel defaultSize={72} minSize={40}>
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
              referralFeedbackApplied={referral.feedbackApplied}
              careNeedHint={referral.searchParams?.care_need ?? null}
              locationHint={referral.searchParams?.location_text ?? null}
              searchRadiusKm={referral.searchParams?.max_distance_km ?? null}
              searchLoading={referral.search.loading}
              searchError={referral.search.error}
              onSidebarSearch={handleSidebarSearch}
              onClearSearch={handleClearSearch}
              onShowReferralRoute={handleShowReferralRoute}
            />
          </Panel>
          <PanelResizeHandle className="w-1 bg-neutral-200 transition-colors hover:bg-neutral-300" />
          <Panel defaultSize={28} minSize={20}>
            <RightChatPanel referral={referral} />
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
