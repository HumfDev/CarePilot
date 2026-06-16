import { createApp, server, lakebase, genie } from '@databricks/appkit';
import { setupHealthcareLakebase } from './lib/lakebase-setup';

const GENIE_HEALTHCARE_SPACE_ID =
  process.env.DATABRICKS_GENIE_SPACE_ID ?? '01f16954e5791df78bb099133a0041be';

createApp({
  plugins: [
    lakebase(),
    server(),
    genie({
      spaces: {
        healthcare: GENIE_HEALTHCARE_SPACE_ID,
      },
    }),
  ],
  async onPluginsReady(appkit) {
    await setupHealthcareLakebase(appkit);
  },
}).catch(console.error);
