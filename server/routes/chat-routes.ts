import { createOpenAI } from '@ai-sdk/openai';
import { streamText, createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { Config } from '@databricks/sdk-experimental';
import type { Application } from 'express';
import { getChatForUser, appendMessage } from '../lib/chat-store';
import { authenticateUser } from '../lib/auth';

interface AppKitWithLakebase {
  lakebase: { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
  server: { extend(fn: (app: Application) => void): void };
}

async function getDatabricksToken() {
  if (process.env.DATABRICKS_TOKEN) return process.env.DATABRICKS_TOKEN;
  const config = new Config({ profile: process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT' });
  await config.ensureResolved();
  const headers = new Headers();
  await config.authenticate(headers);
  const authHeader = headers.get('Authorization');
  if (!authHeader) throw new Error('Failed to get Databricks token. Check your CLI profile or set DATABRICKS_TOKEN.');
  return authHeader.replace('Bearer ', '');
}

function gatewayBaseUrl(): string {
  const workspaceId = process.env.DATABRICKS_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error(
      'DATABRICKS_WORKSPACE_ID is not set — add it to .env for local dev (it is auto-injected on deploy).'
    );
  }
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const suffix = host?.split('.').slice(1).join('.') || 'cloud.databricks.com';
  return `https://${workspaceId}.ai-gateway.${suffix}/mlflow/v1`;
}

export function setupChatRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.post('/api/chat', async (req, res) => {
      const userId = authenticateUser(req, res);
      if (!userId) return;

      const { messages, chatId } = req.body as { messages: UIMessage[]; chatId?: string };

      if (!chatId) {
        res.status(400).json({ error: 'chatId is required' });
        return;
      }
      const chat = await getChatForUser(appkit, chatId, userId);
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }

      const coreMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content:
          m.parts
            ?.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('') ?? '',
      }));

      try {
        const lastUserMsg = coreMessages.filter((m) => m.role === 'user').pop();
        if (lastUserMsg) {
          await appendMessage(appkit, { chatId, userId, role: 'user', content: lastUserMsg.content });
        }

        const token = await getDatabricksToken();
        const endpoint = process.env.DATABRICKS_ENDPOINT || 'databricks-gpt-5-4-mini';
        const databricks = createOpenAI({
          baseURL: gatewayBaseUrl(),
          apiKey: token,
        });

        const stream = createUIMessageStream({
          execute: ({ writer }) => {
            const result = streamText({
              model: databricks.chat(endpoint),
              messages: coreMessages,
              maxOutputTokens: 4096,
              onFinish: async ({ text }) => {
                await appendMessage(appkit, { chatId, userId, role: 'assistant', content: text });
              },
            });
            writer.merge(result.toUIMessageStream());
          },
        });

        pipeUIMessageStreamToResponse({ stream, response: res });
      } catch (err) {
        console.error('[chat]', (err as Error).message);
        if (!res.headersSent) res.status(502).json({ error: 'Chat request failed' });
      }
    });
  });
}
