import { createApp, server, lakebase, genie } from '@databricks/appkit';
import { setupHealthcareLakebase } from './lib/lakebase-setup';
import { setupReferralLakebaseSchema } from './lib/lakebase-referral-schema';
import { setupMapRoutes } from './routes/map-routes';
import { setupMapSearchRoutes } from './routes/map-search-routes';
import { setupReferralRoutes } from './routes/referral-routes';
import { setupRouteMockRoutes } from './routes/route-mock';
import { isGenieEnabled, isLocalDemo, usePythonBridge } from './lib/runtime-config';
import { warmupPythonBridge } from './lib/python-bridge';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
}

function asLakebaseAppkit(appkit: object): AppKitWithLakebase | null {
  if (!('lakebase' in appkit)) return null;
  const lakebase = (appkit as { lakebase?: AppKitWithLakebase['lakebase'] }).lakebase;
  if (!lakebase || typeof lakebase.query !== 'function') return null;
  return { lakebase };
}

const GENIE_HEALTHCARE_SPACE_ID =
  process.env.DATABRICKS_GENIE_SPACE_ID ?? '01f16954e5791df78bb099133a0041be';

const plugins = isLocalDemo()
  ? [server()]
  : [
      lakebase(),
      server(),
      ...(isGenieEnabled()
        ? [
            genie({
              spaces: {
                healthcare: GENIE_HEALTHCARE_SPACE_ID,
              },
            }),
          ]
        : []),
    ];

if (isLocalDemo()) {
  console.log(
    '[carepilot] CAREPILOT_LOCAL_DEMO=1 — Lakebase + Genie skipped. ' +
      'Set CAREPILOT_USE_LAKEBASE_REFERRAL=1 with Lakebase credentials for SQL search, ' +
      'or CAREPILOT_USE_PYTHON_BRIDGE=1 for the CSV bridge.'
  );
} else {
  console.log(
    `[carepilot] Production mode — Lakebase referral search enabled${isGenieEnabled() ? ', Genie enabled' : ', Genie disabled'}.`
  );
}

createApp({
  plugins,
  async onPluginsReady(appkit) {
    const lakeApp = asLakebaseAppkit(appkit);
    if (!isLocalDemo() && lakeApp) {
      try {
        await setupHealthcareLakebase(lakeApp);
      } catch (err) {
        console.error('[carepilot] healthcare Lakebase setup failed:', err);
      }
      try {
        await setupReferralLakebaseSchema(lakeApp.lakebase);
      } catch (err) {
        console.error('[carepilot] referral schema setup failed:', err);
      }
      try {
        setupMapRoutes({ server: appkit.server, lakebase: lakeApp.lakebase });
      } catch (err) {
        console.error('[carepilot] map routes setup failed:', err);
      }
    }

    // Always register referral + utility routes even if Lakebase DDL failed.
    setupReferralRoutes({
      server: appkit.server,
      ...(lakeApp ? { lakebase: lakeApp.lakebase } : {}),
    });
    setupRouteMockRoutes(appkit);
    setupMapSearchRoutes(appkit);

    if (usePythonBridge()) {
      void warmupPythonBridge();
    }
  },
}).catch((err) => {
  console.error('[carepilot] fatal app startup error:', err);
  process.exit(1);
});
