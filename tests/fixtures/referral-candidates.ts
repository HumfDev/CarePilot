import type { ReferralCandidate } from '../../shared/referral';
import type { FacilityRow } from '../../server/lib/referral-scoring';

/** Jaipur city center — matches referral-parse CITY_COORDS. */
export const JAIPUR = { lat: 26.9124, lon: 75.7873 };

function baseCandidate(overrides: Partial<ReferralCandidate> & Pick<ReferralCandidate, 'facility_id' | 'facility_name'>): ReferralCandidate {
  return {
    rank: 1,
    clean_facility_type: 'Hospital',
    clean_city: 'Jaipur',
    clean_district: 'Jaipur',
    clean_state: 'Rajasthan',
    latitude: JAIPUR.lat,
    longitude: JAIPUR.lon,
    distance_km: 5,
    raw_recommendation_score: 70,
    final_recommendation_score: 70,
    feedback_adjusted_score: null,
    feedback_delta: null,
    feedback_signals: null,
    feedback_reason: null,
    score_cap_reason: null,
    uncertainty_level: 'Medium uncertainty',
    evidence_strength_score: 60,
    disease_match_score: 60,
    baseline_trust_score: 70,
    local_need_score: 50,
    score_breakdown: [],
    recommendation_reason: 'fixture',
    evidence_snippets: [],
    missing_evidence_flags: [],
    suspicious_evidence_flags: [],
    source_url_classification: null,
    facility_related_urls: [],
    care_need_evidence_urls: [],
    unrelated_source_urls: [],
    ...overrides,
  };
}

/** Close facility — weaker non-distance signals (used to flip rank at high urgency). */
export const NEAR_CANDIDATE = baseCandidate({
  facility_id: 'fac-near-jaipur',
  facility_name: 'Near Dialysis Center',
  latitude: 26.94,
  longitude: 75.7873,
  distance_km: 3,
  disease_match_score: 60,
  baseline_trust_score: 70,
  evidence_strength_score: 60,
  final_recommendation_score: 72,
});

/** Far facility — stronger trust/evidence/condition (wins at low urgency). */
export const FAR_CANDIDATE = baseCandidate({
  facility_id: 'fac-far-jaipur',
  facility_name: 'Far Specialty Hospital',
  latitude: 26.9124,
  longitude: 76.25,
  distance_km: 45,
  disease_match_score: 90,
  baseline_trust_score: 95,
  evidence_strength_score: 90,
  final_recommendation_score: 88,
});

function baseFacilityRow(overrides: Partial<FacilityRow> & Pick<FacilityRow, 'facility_id' | 'facility_name' | 'latitude' | 'longitude'>): FacilityRow {
  return {
    clean_city: 'Jaipur',
    clean_district: 'Jaipur',
    clean_state: 'Rajasthan',
    clean_facility_type: 'Hospital',
    description: null,
    specialties: null,
    capability: null,
    procedure: null,
    equipment: null,
    source_urls: 'https://example.org/facility',
    trust_score_v2: 70,
    info_richness_score: 50,
    source_count: 2,
    official_website: null,
    official_phone: null,
    institutional_birth_5y_pct: null,
    m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct: null,
    w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct: null,
    child_u5_who_are_stunted_height_for_age_18_pct: null,
    child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct: null,
    hh_member_covered_health_insurance_pct: null,
    ...overrides,
  };
}

export const NEAR_FACILITY_ROW = baseFacilityRow({
  facility_id: 'fac-near-jaipur',
  facility_name: 'Near Dialysis Center',
  latitude: 26.94,
  longitude: 75.7873,
  specialties: 'nephrology dialysis renal',
  trust_score_v2: 70,
});

export const FAR_FACILITY_ROW = baseFacilityRow({
  facility_id: 'fac-far-jaipur',
  facility_name: 'Far Specialty Hospital',
  latitude: 26.9124,
  longitude: 76.25,
  specialties: 'nephrology dialysis hemodialysis renal kidney',
  trust_score_v2: 95,
  info_richness_score: 80,
  source_count: 5,
});

export const MOCK_JAIPUR_FACILITY_ROWS: FacilityRow[] = [NEAR_FACILITY_ROW, FAR_FACILITY_ROW];
