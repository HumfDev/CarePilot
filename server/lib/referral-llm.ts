import { invokeServingChat } from './databricks-llm';
import {
  askGenieText,
  formatGeniePrompt,
  genieReferralReady,
  type GenieReferralClient,
} from './referral-genie';
import { DEFAULT_LLM_MODEL, DEFAULT_REFERRAL_SUMMARIZER, type ReferralSummarizerChoice } from './runtime-config';
import type { ReferralCandidate } from '../../shared/referral';
import { getCachedSummary, payloadHash, saveCachedSummary } from './lakebase-referral-store';

const CARD_SYSTEM_PROMPT = `You are a clinical referral copilot for Indian healthcare planners.
Write 2-4 short paragraphs in plain English. No markdown headings or bullet lists.
Cover ranking rationale, evidence snippets, source URL trust, flags, and one verification action.
Use only the supplied JSON. Be cautious — this is not medical advice.`;

const SEARCH_SYSTEM_PROMPT = `You are CarePilot Referral Copilot. Summarize ranked facility candidates for a planner.
Write 2-3 sentences: count, top candidate with score and distance, uncertainty note, and verify-before-referral disclaimer.
Use only supplied data. No markdown.`;

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ReferralLlmContext {
  genie?: GenieReferralClient | null;
  summarizer?: ReferralSummarizerChoice;
}

async function invokeReferralText(
  system: string,
  user: string,
  ctx: ReferralLlmContext | undefined,
  serving: { model?: string; maxTokens?: number; temperature?: number }
): Promise<{ text: string; engine: 'genie' | 'model_serving'; model: string }> {
  const model = serving.model ?? DEFAULT_LLM_MODEL;
  const summarizer = ctx?.summarizer ?? DEFAULT_REFERRAL_SUMMARIZER;

  if (summarizer === 'genie' && genieReferralReady(ctx?.genie, summarizer)) {
    try {
      const text = await askGenieText(ctx.genie, formatGeniePrompt(system, user), {
        timeout: 90_000,
      });
      return { text, engine: 'genie', model: 'genie' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[referral-llm] Genie failed, falling back to Model Serving:', message);
    }
  }

  const text = await invokeServingChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    serving
  );
  return { text, engine: 'model_serving', model };
}

export async function summarizeCandidateCard(
  appkit: LakebaseQueryable | null,
  input: {
    scenario_id: string;
    candidate: ReferralCandidate;
    care_need: string;
    care_type?: string;
    model?: string;
  },
  ctx?: ReferralLlmContext
): Promise<{ summary: string; model: string; cached: boolean; engine?: 'genie' | 'model_serving' }> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const hash = payloadHash({ candidate: input.candidate, care_need: input.care_need, v: 'en-v3-genie' });

  if (appkit) {
    const cached = await getCachedSummary(appkit, input.scenario_id, input.candidate.facility_id, model, hash);
    if (cached) return { summary: cached, model, cached: true };
  }

  const user = `Patient need: ${input.care_need} (care_type=${input.care_type ?? 'specialist'})\n\nCandidate JSON:\n${JSON.stringify(input.candidate, null, 2)}`;
  const { text, engine, model: usedModel } = await invokeReferralText(CARD_SYSTEM_PROMPT, user, ctx, {
    model,
    maxTokens: 700,
    temperature: 0.2,
  });

  if (appkit) {
    await saveCachedSummary(appkit, input.scenario_id, input.candidate.facility_id, usedModel, hash, text);
  }

  return { summary: text, model: usedModel, cached: false, engine };
}

export async function summarizeSearchResults(
  input: {
    care_need: string;
    care_type?: string;
    location_text?: string | null;
    candidates: ReferralCandidate[];
    feedback_applied?: boolean;
    model?: string;
  },
  ctx?: ReferralLlmContext
): Promise<{ summary: string; engine: 'genie' | 'model_serving'; model: string }> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const top = input.candidates.slice(0, 5).map((c) => ({
    rank: c.rank,
    facility_name: c.facility_name,
    score: c.feedback_adjusted_score ?? c.final_recommendation_score,
    distance_km: c.distance_km,
    uncertainty_level: c.uncertainty_level,
  }));

  const user = JSON.stringify({
    care_need: input.care_need,
    care_type: input.care_type,
    location_text: input.location_text,
    feedback_applied: input.feedback_applied ?? false,
    candidates: top,
  });

  const { text, engine, model: usedModel } = await invokeReferralText(SEARCH_SYSTEM_PROMPT, user, ctx, {
    model,
    maxTokens: 320,
    temperature: 0.2,
  });

  return { summary: text, engine, model: usedModel };
}

export async function classifyReferralIntent(
  input: {
    message: string;
    care_need: string;
    candidate_count: number;
    top_facility_name?: string | null;
    model?: string;
  },
  ctx?: ReferralLlmContext
): Promise<'new_search' | 'follow_up'> {
  const lower = input.message.toLowerCase();
  if (/\bnear\b|\bfind\b|\bsearch\b|\bin\s+[a-z]/i.test(lower)) return 'new_search';

  const model = input.model ?? DEFAULT_LLM_MODEL;
  const system =
    'Classify the user message as new_search or follow_up about existing ranked referral results. Reply with only one token: new_search or follow_up.';
  const user = JSON.stringify({
    message: input.message,
    current_care_need: input.care_need,
    candidate_count: input.candidate_count,
    top_facility_name: input.top_facility_name,
  });

  try {
    const { text } = await invokeReferralText(system, user, ctx, {
      model,
      maxTokens: 16,
      temperature: 0,
    });
    if (text.includes('new_search')) return 'new_search';
    return 'follow_up';
  } catch {
    return 'follow_up';
  }
}

export async function answerReferralFollowUp(
  input: {
    message: string;
    care_need: string;
    candidates: ReferralCandidate[];
    feedback_applied?: boolean;
    model?: string;
  },
  ctx?: ReferralLlmContext
): Promise<{ reply: string; engine: 'genie' | 'model_serving'; model: string }> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const system =
    'Answer follow-up questions about already-ranked referral candidates. Use only supplied JSON. Be concise and cautious. Not medical advice.';
  const user = JSON.stringify({
    question: input.message,
    care_need: input.care_need,
    feedback_applied: input.feedback_applied ?? false,
    candidates: input.candidates.slice(0, 8),
  });

  const { text, engine, model: usedModel } = await invokeReferralText(system, user, ctx, {
    model,
    maxTokens: 400,
    temperature: 0.2,
  });

  return { reply: text, engine, model: usedModel };
}

export function referralSummarizerLabel(summarizer: ReferralSummarizerChoice = DEFAULT_REFERRAL_SUMMARIZER): ReferralSummarizerChoice {
  return summarizer;
}
