import type { FacilityRow } from '../../server/lib/referral-scoring';
import { MOCK_JAIPUR_FACILITY_ROWS } from './referral-candidates';

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function facilityRowToSqlRow(row: FacilityRow): Record<string, unknown> {
  return {
    facility_id: row.facility_id,
    facility_name: row.facility_name,
    latitude: row.latitude,
    longitude: row.longitude,
    clean_city: row.clean_city,
    clean_district: row.clean_district,
    clean_state: row.clean_state,
    clean_facility_type: row.clean_facility_type,
    description: row.description,
    specialties: row.specialties,
    capability: row.capability,
    procedure: row.procedure,
    equipment: row.equipment,
    source_urls: row.source_urls,
    trust_score_v2: row.trust_score_v2,
    info_richness_score: row.info_richness_score,
    source_count: row.source_count,
    official_website: row.official_website,
    official_phone: row.official_phone,
    institutional_birth_5y_pct: row.institutional_birth_5y_pct,
    m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct:
      row.m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct,
    w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct:
      row.w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
    child_u5_who_are_stunted_height_for_age_18_pct: row.child_u5_who_are_stunted_height_for_age_18_pct,
    child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct: row.child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct,
    hh_member_covered_health_insurance_pct: row.hh_member_covered_health_insurance_pct,
  };
}

/** In-memory Lakebase stub for referral search integration tests. */
export function createMockLakebase(facilities: FacilityRow[] = MOCK_JAIPUR_FACILITY_ROWS): LakebaseQueryable {
  const sqlRows = facilities.map(facilityRowToSqlRow);

  return {
    async query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('from ') && normalized.includes('facilities') && normalized.includes('facility_features')) {
        const minLat = Number(params?.[0]);
        const maxLat = Number(params?.[1]);
        const minLon = Number(params?.[2]);
        const maxLon = Number(params?.[3]);
        const rows = sqlRows.filter((row) => {
          const lat = Number(row.latitude);
          const lon = Number(row.longitude);
          return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
        });
        return { rows };
      }

      if (normalized.includes('referral.scenario_history')) {
        return { rows: [] };
      }

      if (
        normalized.includes('referral.saved_shortlists') ||
        normalized.includes('referral.user_notes') ||
        normalized.includes('referral.review_decisions') ||
        normalized.includes('referral.manual_overrides')
      ) {
        return { rows: [] };
      }

      if (normalized.includes('count(*)')) {
        return { rows: [{ facilities: facilities.length, scored: facilities.length }] };
      }

      return { rows: [] };
    },
  };
}
