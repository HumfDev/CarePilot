/**
 * HTTP integration smoke test for the merged referral flow:
 *   parse (care need + location + urgency fallback) → search (Lakebase mock + urgency re-weight)
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.test.json scripts/smoke-referral-api.ts
 */
import express, { type Application } from 'express';
import http from 'node:http';
import { setupReferralRoutes } from '../server/routes/referral-routes';
import { createMockLakebase } from '../tests/fixtures/mock-lakebase';

process.env.CAREPILOT_LOCAL_DEMO = '1';
process.env.CAREPILOT_USE_LAKEBASE_REFERRAL = '1';
delete process.env.CAREPILOT_USE_PYTHON_BRIDGE;
delete process.env.DATABRICKS_HOST;
delete process.env.DATABRICKS_TOKEN;

interface AppKitLike {
  server: { extend(fn: (app: Application) => void): void };
  lakebase: ReturnType<typeof createMockLakebase>;
}

function startApp(): Promise<{ port: number; server: http.Server }> {
  const app = express();
  app.use(express.json());
  const appkit: AppKitLike = {
    server: {
      extend(fn) {
        fn(app);
      },
    },
    lakebase: createMockLakebase(),
  };
  setupReferralRoutes(appkit);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ port: addr.port, server });
    });
  });
}

async function getJSON(port: number, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

async function postJSON(port: number, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

function fail(message: string, ...rest: unknown[]): never {
  console.error('FAIL', message, ...rest);
  process.exit(1);
}

async function main(): Promise<void> {
  const { port, server } = await startApp();

  const status = await getJSON(port, '/api/referral/status');
  if (status.ok !== true) fail('status endpoint should return ok=true', status);
  if (status.engine !== 'lakebase_sql') fail('expected lakebase_sql engine', status);
  console.log('status OK:', status.engine);

  const parsed = await postJSON(port, '/api/referral/parse', {
    message: 'dialysis near Jaipur',
  });
  if (parsed.ok !== true) fail('parse should succeed for dialysis near Jaipur', parsed);
  if (parsed.care_need !== 'dialysis') fail('parse care_need mismatch', parsed);
  if (typeof parsed.urgency_score !== 'number') fail('parse should include urgency_score', parsed);
  if (typeof parsed.urgency_label !== 'string') fail('parse should include urgency_label', parsed);
  console.log('parse OK:', {
    care_need: parsed.care_need,
    urgency_score: parsed.urgency_score,
    urgency_label: parsed.urgency_label,
    department: parsed.department,
  });

  const lowSearch = await postJSON(port, '/api/referral/search', {
    care_need: parsed.care_need,
    care_type: parsed.care_type,
    user_lat: parsed.user_lat,
    user_lon: parsed.user_lon,
    location_text: parsed.location_text,
    ranking_priority: parsed.ranking_priority,
    max_distance_km: parsed.max_distance_km,
    top_n: parsed.top_n,
    urgency_score: 3,
  });
  if (lowSearch.ok !== true) fail('low-urgency search failed', lowSearch);
  const lowCandidates = lowSearch.candidates as Array<Record<string, unknown>>;
  if (!Array.isArray(lowCandidates) || lowCandidates.length < 2) {
    fail('expected at least 2 mock candidates', lowSearch);
  }
  const lowTopId = String(lowCandidates[0]?.facility_id);

  const highSearch = await postJSON(port, '/api/referral/search', {
    care_need: parsed.care_need,
    care_type: parsed.care_type,
    user_lat: parsed.user_lat,
    user_lon: parsed.user_lon,
    location_text: parsed.location_text,
    ranking_priority: parsed.ranking_priority,
    max_distance_km: parsed.max_distance_km,
    top_n: parsed.top_n,
    urgency_score: 10,
  });
  if (highSearch.ok !== true) fail('high-urgency search failed', highSearch);
  const highCandidates = highSearch.candidates as Array<Record<string, unknown>>;
  const highTopId = String(highCandidates[0]?.facility_id);

  if (lowTopId === highTopId) {
    fail('urgency re-weighting should change top-ranked facility between u=3 and u=10', {
      lowTopId,
      highTopId,
      lowSearch,
      highSearch,
    });
  }
  console.log('urgency re-rank OK:', { lowTopId, highTopId });

  const missing = await postJSON(port, '/api/referral/search', {
    care_need: '',
    user_lat: 26.9,
    user_lon: 75.7,
  });
  if (missing.ok !== false) fail('search should 400 on missing care_need', missing);
  console.log('validation OK');

  server.close();
  console.log('\nALL REFERRAL API SMOKE CHECKS PASSED');
}

void main();
