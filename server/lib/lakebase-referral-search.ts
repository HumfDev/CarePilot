import { LB } from './lakebase-tables';
import {
  applyFeedbackReranking,
  rankFacilityRows,
  type FacilityRow,
  type SearchScoreInput,
} from './referral-scoring';
import { getFeedbackForScenario, makeScenarioId, saveScenario } from './lakebase-referral-store';
import type { ReferralCandidate } from '../../shared/referral';

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToFacility(row: Record<string, unknown>): FacilityRow | null {
  const lat = asNumber(row.latitude) ?? asNumber(row.resolved_latitude);
  const lon = asNumber(row.longitude) ?? asNumber(row.resolved_longitude);
  if (lat == null || lon == null) return null;

  return {
    facility_id: asString(row.facility_id),
    facility_name: asString(row.facility_name, 'Unknown facility'),
    latitude: lat,
    longitude: lon,
    clean_city: row.clean_city != null ? asString(row.clean_city) : row.address_city != null ? asString(row.address_city) : null,
    clean_district: row.clean_district != null ? asString(row.clean_district) : row.resolved_district != null ? asString(row.resolved_district) : null,
    clean_state: row.clean_state != null ? asString(row.clean_state) : row.resolved_state != null ? asString(row.resolved_state) : null,
    clean_facility_type: row.clean_facility_type != null ? asString(row.clean_facility_type) : row.facilitytypeid != null ? asString(row.facilitytypeid) : null,
    description: row.description != null ? asString(row.description) : null,
    specialties: row.specialties != null ? asString(row.specialties) : null,
    capability: row.capability != null ? asString(row.capability) : null,
    procedure: row.procedure != null ? asString(row.procedure) : null,
    equipment: row.equipment != null ? asString(row.equipment) : null,
    source_urls: row.source_urls != null ? asString(row.source_urls) : null,
    trust_score_v2: asNumber(row.trust_score_v2),
    info_richness_score: asNumber(row.info_richness_score),
    source_count: asNumber(row.source_count),
    official_website: row.official_website != null ? asString(row.official_website) : null,
    official_phone: row.official_phone != null ? asString(row.official_phone) : null,
    institutional_birth_5y_pct: asNumber(row.institutional_birth_5y_pct),
    m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct: asNumber(
      row.m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct
    ),
    w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct: asNumber(
      row.w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct
    ),
    child_u5_who_are_stunted_height_for_age_18_pct: asNumber(row.child_u5_who_are_stunted_height_for_age_18_pct),
    child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct: asNumber(row.child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct),
    hh_member_covered_health_insurance_pct: asNumber(row.hh_member_covered_health_insurance_pct),
  };
}

const FACILITY_SEARCH_SQL = `
  SELECT
    f.unique_id AS facility_id,
    COALESCE(s.facility_name, f.name) AS facility_name,
    COALESCE(s.resolved_latitude, f.latitude) AS latitude,
    COALESCE(s.resolved_longitude, f.longitude) AS longitude,
    COALESCE(s.resolved_city, f.address_city) AS clean_city,
    s.resolved_district AS clean_district,
    COALESCE(s.resolved_state, f."address_stateOrRegion") AS clean_state,
    s."facilityTypeId" AS clean_facility_type,
    s.description,
    s.specialties,
    s.capability,
    s.procedure,
    s.equipment,
    s.source_urls,
    s.trust_score_v2,
    s.info_richness_score,
    s.source_count,
    s.official_website,
    s.official_phone,
    s.institutional_birth_5y_pct,
    s.m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct,
    s.w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
    s.child_u5_who_are_stunted_height_for_age_18_pct,
    s.child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct,
    s.hh_member_covered_health_insurance_pct
  FROM ${LB.facilities} f
  INNER JOIN ${LB.facilityFeaturesV4} s ON f.unique_id = s.facility_id
  WHERE f.latitude IS NOT NULL
    AND f.longitude IS NOT NULL
    AND f.latitude BETWEEN $1 AND $2
    AND f.longitude BETWEEN $3 AND $4
    AND s.trust_score_v2 IS NOT NULL
`;

export async function searchReferralCandidatesLakebase(
  appkit: LakebaseQueryable,
  input: SearchScoreInput & {
    location_text?: string | null;
    use_feedback_reranking?: boolean;
  }
): Promise<{ scenario_id: string; feedback_applied: boolean; candidates: ReferralCandidate[] }> {
  const latPad = input.max_distance_km / 111;
  const lonPad = input.max_distance_km / (111 * Math.cos((input.user_lat * Math.PI) / 180));

  const result = await appkit.query(FACILITY_SEARCH_SQL, [
    input.user_lat - latPad,
    input.user_lat + latPad,
    input.user_lon - lonPad,
    input.user_lon + lonPad,
  ]);

  const rows = result.rows
    .map(rowToFacility)
    .filter((r): r is FacilityRow => r != null);

  let candidates = rankFacilityRows(rows, input);
  const scenarioId = makeScenarioId(
    input.care_need,
    input.care_type,
    input.user_lat,
    input.user_lon,
    input.max_distance_km
  );

  await saveScenario(appkit, {
    scenario_id: scenarioId,
    user_location: input.location_text,
    user_lat: input.user_lat,
    user_lon: input.user_lon,
    care_need: input.care_need,
    care_type: input.care_type,
    ranking_priority: input.ranking_priority,
    max_distance_km: input.max_distance_km,
  });

  let feedbackApplied = false;
  if (input.use_feedback_reranking !== false) {
    const feedback = await getFeedbackForScenario(appkit, scenarioId);
    const hasFeedback =
      feedback.shortlisted_facility_ids.length > 0 ||
      Object.keys(feedback.decisions_by_facility_id).length > 0 ||
      Object.keys(feedback.overrides_by_facility_id).length > 0 ||
      Object.keys(feedback.notes_by_facility_id).length > 0;
    if (hasFeedback) {
      candidates = applyFeedbackReranking(candidates, feedback).map((c, i) => ({ ...c, rank: i + 1 }));
      feedbackApplied = true;
    }
  }

  return { scenario_id: scenarioId, feedback_applied: feedbackApplied, candidates };
}

export async function checkLakebaseReferralReady(appkit: LakebaseQueryable): Promise<{
  ready: boolean;
  facilityCount: number;
  scoredCount: number;
}> {
  try {
    const result = await appkit.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ${LB.facilities}) AS facilities,
         (SELECT COUNT(*)::int FROM ${LB.facilityFeaturesV4}) AS scored`
    );
    const facilities = Number(result.rows[0]?.facilities ?? 0);
    const scored = Number(result.rows[0]?.scored ?? 0);
    return { ready: facilities > 0 && scored > 0, facilityCount: facilities, scoredCount: scored };
  } catch {
    return { ready: false, facilityCount: 0, scoredCount: 0 };
  }
}
