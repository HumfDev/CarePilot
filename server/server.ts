import { createApp, server, lakebase, genie } from '@databricks/appkit';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';

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
    await setupChatTables(appkit);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
  },
}).catch(console.error);
