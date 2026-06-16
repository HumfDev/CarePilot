import type { ReferralCandidate } from '../../shared/referral';
import { makeScenarioId, payloadHash } from './lakebase-referral-schema';
import type { WorkspaceFeedback } from './referral-scoring';

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function saveScenario(
  appkit: LakebaseQueryable,
  input: {
    scenario_id: string;
    user_location?: string | null;
    user_lat: number;
    user_lon: number;
    care_need: string;
    care_type: string;
    ranking_priority: string;
    max_distance_km: number;
  }
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.scenario_history
      (scenario_id, user_location, user_lat, user_lon, care_need, care_type, ranking_priority, max_distance_km)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (scenario_id) DO UPDATE SET
       user_location = EXCLUDED.user_location,
       user_lat = EXCLUDED.user_lat,
       user_lon = EXCLUDED.user_lon,
       care_need = EXCLUDED.care_need,
       care_type = EXCLUDED.care_type,
       ranking_priority = EXCLUDED.ranking_priority,
       max_distance_km = EXCLUDED.max_distance_km`,
    [
      input.scenario_id,
      input.user_location ?? null,
      input.user_lat,
      input.user_lon,
      input.care_need,
      input.care_type,
      input.ranking_priority,
      input.max_distance_km,
    ]
  );
}

export async function getFeedbackForScenario(
  appkit: LakebaseQueryable,
  scenarioId: string
): Promise<WorkspaceFeedback> {
  const [shortlist, notes, decisions, overrides] = await Promise.all([
    appkit.query(
      `SELECT facility_id FROM referral.saved_shortlists WHERE scenario_id = $1`,
      [scenarioId]
    ),
    appkit.query(
      `SELECT facility_id, note_text FROM referral.user_notes WHERE scenario_id = $1 ORDER BY created_at`,
      [scenarioId]
    ),
    appkit.query(
      `SELECT facility_id, status FROM referral.review_decisions WHERE scenario_id = $1`,
      [scenarioId]
    ),
    appkit.query(
      `SELECT facility_id, override_score, override_reason
       FROM referral.manual_overrides WHERE scenario_id = $1`,
      [scenarioId]
    ),
  ]);

  const notesBy: Record<string, string[]> = {};
  for (const row of notes.rows) {
    const fid = String(row.facility_id);
    notesBy[fid] = notesBy[fid] ?? [];
    notesBy[fid].push(String(row.note_text));
  }

  const decisionsBy: Record<string, string> = {};
  for (const row of decisions.rows) {
    decisionsBy[String(row.facility_id)] = String(row.status);
  }

  const overridesBy: WorkspaceFeedback['overrides_by_facility_id'] = {};
  for (const row of overrides.rows) {
    overridesBy[String(row.facility_id)] = {
      override_score: Number(row.override_score),
      override_reason: row.override_reason != null ? String(row.override_reason) : undefined,
    };
  }

  return {
    shortlisted_facility_ids: shortlist.rows.map((r) => String(r.facility_id)),
    notes_by_facility_id: notesBy,
    decisions_by_facility_id: decisionsBy,
    overrides_by_facility_id: overridesBy,
  };
}

export async function saveShortlist(
  appkit: LakebaseQueryable,
  scenarioId: string,
  candidate: Pick<ReferralCandidate, 'facility_id' | 'facility_name' | 'final_recommendation_score' | 'uncertainty_level'>
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.saved_shortlists
      (scenario_id, facility_id, facility_name, final_recommendation_score, uncertainty_level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scenario_id, facility_id) DO UPDATE SET
       facility_name = EXCLUDED.facility_name,
       final_recommendation_score = EXCLUDED.final_recommendation_score,
       uncertainty_level = EXCLUDED.uncertainty_level,
       saved_at = NOW()`,
    [
      scenarioId,
      candidate.facility_id,
      candidate.facility_name,
      candidate.final_recommendation_score,
      candidate.uncertainty_level,
    ]
  );
}

export async function saveNote(
  appkit: LakebaseQueryable,
  scenarioId: string,
  facilityId: string,
  note: string
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.user_notes (scenario_id, facility_id, note_text) VALUES ($1, $2, $3)`,
    [scenarioId, facilityId, note]
  );
}

export async function saveReview(
  appkit: LakebaseQueryable,
  scenarioId: string,
  facilityId: string,
  status: string,
  reviewerNote?: string
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.review_decisions (scenario_id, facility_id, status, reviewer_note, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (scenario_id, facility_id) DO UPDATE SET
       status = EXCLUDED.status,
       reviewer_note = EXCLUDED.reviewer_note,
       updated_at = NOW()`,
    [scenarioId, facilityId, status, reviewerNote ?? null]
  );
}

export async function saveOverride(
  appkit: LakebaseQueryable,
  scenarioId: string,
  facilityId: string,
  originalScore: number,
  overrideScore: number,
  reason: string
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.manual_overrides
      (scenario_id, facility_id, original_score, override_score, override_reason, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (scenario_id, facility_id) DO UPDATE SET
       original_score = EXCLUDED.original_score,
       override_score = EXCLUDED.override_score,
       override_reason = EXCLUDED.override_reason,
       updated_at = NOW()`,
    [scenarioId, facilityId, originalScore, overrideScore, reason]
  );
}

export async function getCachedSummary(
  appkit: LakebaseQueryable,
  scenarioId: string,
  facilityId: string,
  model: string,
  hash: string
): Promise<string | null> {
  const result = await appkit.query(
    `SELECT summary FROM referral.llm_summary_cache
     WHERE scenario_id = $1 AND facility_id = $2 AND model = $3 AND payload_hash = $4`,
    [scenarioId, facilityId, model, hash]
  );
  const summary = result.rows[0]?.summary;
  return summary != null ? String(summary) : null;
}

export async function saveCachedSummary(
  appkit: LakebaseQueryable,
  scenarioId: string,
  facilityId: string,
  model: string,
  hash: string,
  summary: string
): Promise<void> {
  await appkit.query(
    `INSERT INTO referral.llm_summary_cache (scenario_id, facility_id, model, payload_hash, summary)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scenario_id, facility_id, model, payload_hash) DO UPDATE SET
       summary = EXCLUDED.summary,
       created_at = NOW()`,
    [scenarioId, facilityId, model, hash, summary]
  );
}

export { makeScenarioId, payloadHash };
