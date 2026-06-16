import { createApp, server, lakebase } from '@databricks/appkit';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupChatTables(appkit);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
  },
}).catch(console.error);
