import { createHash } from 'node:crypto';

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function setupReferralLakebaseSchema(appkit: LakebaseQueryable): Promise<void> {
  await appkit.query('CREATE SCHEMA IF NOT EXISTS referral');

  const tables = [
    `CREATE TABLE IF NOT EXISTS referral.scenario_history (
      scenario_id TEXT PRIMARY KEY,
      user_location TEXT,
      user_lat DOUBLE PRECISION,
      user_lon DOUBLE PRECISION,
      care_need TEXT NOT NULL,
      care_type TEXT NOT NULL,
      ranking_priority TEXT,
      max_distance_km DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral.saved_shortlists (
      id BIGSERIAL PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      facility_id TEXT NOT NULL,
      facility_name TEXT,
      final_recommendation_score DOUBLE PRECISION,
      uncertainty_level TEXT,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (scenario_id, facility_id)
    )`,
    `CREATE TABLE IF NOT EXISTS referral.user_notes (
      id BIGSERIAL PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      facility_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral.review_decisions (
      scenario_id TEXT NOT NULL,
      facility_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewer_note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scenario_id, facility_id)
    )`,
    `CREATE TABLE IF NOT EXISTS referral.manual_overrides (
      scenario_id TEXT NOT NULL,
      facility_id TEXT NOT NULL,
      original_score DOUBLE PRECISION,
      override_score DOUBLE PRECISION,
      override_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scenario_id, facility_id)
    )`,
    `CREATE TABLE IF NOT EXISTS referral.llm_summary_cache (
      scenario_id TEXT NOT NULL,
      facility_id TEXT NOT NULL,
      model TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scenario_id, facility_id, model, payload_hash)
    )`,
  ];

  for (const ddl of tables) {
    await appkit.query(ddl);
  }
}

export function makeScenarioId(
  careNeed: string,
  careType: string,
  lat: number,
  lon: number,
  maxDistanceKm: number
): string {
  const key = `${careNeed}|${careType}|${lat.toFixed(4)}|${lon.toFixed(4)}|${maxDistanceKm.toFixed(1)}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}
