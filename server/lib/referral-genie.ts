import { GENIE_REFERRAL_ALIAS, useGenieForReferral } from './runtime-config';

/** Minimal Genie plugin surface used by referral summarization. */
export interface GenieReferralClient {
  sendMessage: (
    alias: string,
    content: string,
    conversationId?: string,
    options?: { timeout?: number; signal?: AbortSignal }
  ) => AsyncGenerator<{
    type: string;
    message?: { content?: string };
    error?: string;
  }>;
}

export { GENIE_REFERRAL_ALIAS };

export async function askGenieText(
  genie: GenieReferralClient,
  prompt: string,
  options: { timeout?: number } = {}
): Promise<string> {
  let text = '';
  let lastError = '';

  for await (const event of genie.sendMessage(GENIE_REFERRAL_ALIAS, prompt, undefined, {
    timeout: options.timeout ?? 90_000,
  })) {
    if (event.type === 'message_result') {
      text = event.message?.content?.trim() ?? '';
    } else if (event.type === 'error') {
      lastError = event.error ?? 'Genie error';
    }
  }

  if (lastError && !text) throw new Error(lastError);
  if (!text) throw new Error('Genie returned an empty response');
  return text;
}

export function genieReferralReady(genie: GenieReferralClient | null | undefined): genie is GenieReferralClient {
  return Boolean(genie) && useGenieForReferral();
}

export function formatGeniePrompt(system: string, user: string): string {
  return `${system.trim()}\n\n---\n\n${user.trim()}`;
}
