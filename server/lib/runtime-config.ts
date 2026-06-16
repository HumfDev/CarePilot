/**
 * Runtime mode for CarePilot Referral Copilot.
 *
 * Production (Databricks App): leave CAREPILOT_LOCAL_DEMO unset — Lakebase +
 * Genie plugins load and referral search uses Lakebase SQL.
 *
 * Local without Lakebase: CAREPILOT_LOCAL_DEMO=1 skips plugins; optional Python
 * bridge fallback when CAREPILOT_USE_PYTHON_BRIDGE=1.
 */
export function isLocalDemo(): boolean {
  return process.env.CAREPILOT_LOCAL_DEMO === '1';
}

export function isGenieEnabled(): boolean {
  if (isLocalDemo()) return process.env.CAREPILOT_ENABLE_GENIE === '1';
  return process.env.CAREPILOT_ENABLE_GENIE !== '0';
}

export function usePythonBridge(): boolean {
  return process.env.CAREPILOT_USE_PYTHON_BRIDGE === '1';
}

/** Use Genie (not Model Serving) for referral summaries, follow-ups, and intent. */
export function useGenieForReferral(): boolean {
  if (!isGenieEnabled()) return false;
  if (process.env.CAREPILOT_USE_GENIE_REFERRAL === '0') return false;
  if (process.env.CAREPILOT_USE_GENIE_REFERRAL === '1') return true;
  return true;
}

export type ReferralSummarizerChoice = 'genie' | 'llama';

export function parseReferralSummarizer(value: unknown): ReferralSummarizerChoice {
  if (value === 'llama' || value === 'model_serving') return 'llama';
  return 'genie';
}

export const DEFAULT_REFERRAL_SUMMARIZER: ReferralSummarizerChoice = 'genie';

export const GENIE_REFERRAL_ALIAS = process.env.CAREPILOT_GENIE_REFERRAL_ALIAS ?? 'healthcare';

/** Primary referral path: Lakebase SQL + TypeScript scoring. */
export function useLakebaseReferral(): boolean {
  if (usePythonBridge()) return false;
  if (process.env.CAREPILOT_USE_LAKEBASE_REFERRAL === '0') return false;
  if (!isLocalDemo()) return true;
  return process.env.CAREPILOT_USE_LAKEBASE_REFERRAL === '1';
}

export const DEFAULT_LLM_MODEL =
  process.env.CAREPILOT_LLM_MODEL ??
  process.env.DATABRICKS_SERVING_ENDPOINT_NAME ??
  'databricks-llama-4-maverick';
