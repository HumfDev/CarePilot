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
