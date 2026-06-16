import { createApp, server, genie } from '@databricks/appkit';

const GENIE_HEALTHCARE_SPACE_ID =
  process.env.DATABRICKS_GENIE_SPACE_ID ?? '01f16954e5791df78bb099133a0041be';

createApp({
  plugins: [
    server(),
    genie({
      spaces: {
        healthcare: GENIE_HEALTHCARE_SPACE_ID,
      },
    }),
  ],
}).catch(console.error);
