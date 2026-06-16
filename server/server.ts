import { createApp, server, lakebase, genie } from '@databricks/appkit';
import { setupHealthcareLakebase } from './lib/lakebase-setup';
import { setupMapRoutes } from './routes/map-routes';
import { setupReferralRoutes } from './routes/referral-routes';
import { setupRouteMockRoutes } from './routes/route-mock';
import { warmupPythonBridge } from './lib/python-bridge';

const GENIE_HEALTHCARE_SPACE_ID =
  process.env.DATABRICKS_GENIE_SPACE_ID ?? '01f16954e5791df78bb099133a0041be';

// `CAREPILOT_LOCAL_DEMO=1` skips the Lakebase + Genie plugins so the dev
// server boots without Postgres/Genie credentials. The Referral Copilot flow
// (Python bridge) and the mock-route endpoint don't need either of those, and
// the React shell falls back to the static facilities-fallback.json when the
// Lakebase-backed /api/map/facilities is absent. Production deploys leave the
// flag unset and get the full plugin stack.
const LOCAL_DEMO = process.env.CAREPILOT_LOCAL_DEMO === '1';

const plugins = LOCAL_DEMO
  ? [server()]
  : [
      lakebase(),
      server(),
      genie({
        spaces: {
          healthcare: GENIE_HEALTHCARE_SPACE_ID,
        },
      }),
    ];

if (LOCAL_DEMO) {
  console.log(
    '[carepilot] CAREPILOT_LOCAL_DEMO=1 — Lakebase + Genie skipped; ' +
      'serving Referral Copilot + mock-route endpoints only.',
  );
}

createApp({
  plugins,
  async onPluginsReady(appkit) {
    if (!LOCAL_DEMO) {
      await setupHealthcareLakebase(appkit);
      setupMapRoutes(appkit);
    }
    setupReferralRoutes(appkit);
    setupRouteMockRoutes(appkit);
    // Fire-and-forget warmup so the first chat search is fast. Failures are
    // logged but do not block server boot — the bridge will lazily warm on the
    // first real request.
    void warmupPythonBridge();
  },
}).catch(console.error);
