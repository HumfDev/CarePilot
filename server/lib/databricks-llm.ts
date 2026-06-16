import { Config } from '@databricks/sdk-experimental';
import { DEFAULT_LLM_MODEL } from './runtime-config';

export async function getDatabricksToken(): Promise<string> {
  if (process.env.DATABRICKS_TOKEN) return process.env.DATABRICKS_TOKEN;
  const config = new Config({ profile: process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT' });
  await config.ensureResolved();
  const headers = new Headers();
  await config.authenticate(headers);
  const authHeader = headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Failed to get Databricks token. Set DATABRICKS_TOKEN or configure the CLI profile.');
  }
  return authHeader.replace('Bearer ', '');
}

function workspaceHost(): string {
  const host = process.env.DATABRICKS_HOST;
  if (!host) throw new Error('DATABRICKS_HOST is not set.');
  return host.replace(/\/$/, '');
}

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function invokeServingChat(
  messages: ChatMessageInput[],
  options: { model?: string; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const model = options.model ?? DEFAULT_LLM_MODEL;
  const token = await getDatabricksToken();
  const resp = await fetch(`${workspaceHost()}/serving-endpoints/${model}/invocations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.2,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Model Serving ${model} failed (${resp.status}): ${body.slice(0, 400)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    candidates?: Array<{ content?: string }>;
  };
  const content =
    data.choices?.[0]?.message?.content ??
    data.candidates?.[0]?.content ??
    '';
  return content.trim();
}
