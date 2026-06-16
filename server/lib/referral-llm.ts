import { invokeServingChat } from './databricks-llm';
import { DEFAULT_LLM_MODEL } from './runtime-config';
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

export async function summarizeCandidateCard(
  appkit: LakebaseQueryable | null,
  input: {
    scenario_id: string;
    candidate: ReferralCandidate;
    care_need: string;
    care_type?: string;
    model?: string;
  }
): Promise<{ summary: string; model: string; cached: boolean }> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const hash = payloadHash({ candidate: input.candidate, care_need: input.care_need, v: 'en-v2' });

  if (appkit) {
    const cached = await getCachedSummary(appkit, input.scenario_id, input.candidate.facility_id, model, hash);
    if (cached) return { summary: cached, model, cached: true };
  }

  const summary = await invokeServingChat(
    [
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Patient need: ${input.care_need} (care_type=${input.care_type ?? 'specialist'})\n\nCandidate JSON:\n${JSON.stringify(input.candidate, null, 2)}`,
      },
    ],
    { model, maxTokens: 700, temperature: 0.2 }
  );

  if (appkit) {
    await saveCachedSummary(appkit, input.scenario_id, input.candidate.facility_id, model, hash, summary);
  }

  return { summary, model, cached: false };
}

export async function summarizeSearchResults(input: {
  care_need: string;
  care_type?: string;
  location_text?: string | null;
  candidates: ReferralCandidate[];
  feedback_applied?: boolean;
  model?: string;
}): Promise<string> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const top = input.candidates.slice(0, 5).map((c) => ({
    rank: c.rank,
    facility_name: c.facility_name,
    score: c.feedback_adjusted_score ?? c.final_recommendation_score,
    distance_km: c.distance_km,
    uncertainty_level: c.uncertainty_level,
  }));

  return invokeServingChat(
    [
      { role: 'system', content: SEARCH_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          care_need: input.care_need,
          care_type: input.care_type,
          location_text: input.location_text,
          feedback_applied: input.feedback_applied ?? false,
          candidates: top,
        }),
      },
    ],
    { model, maxTokens: 320, temperature: 0.2 }
  );
}

export async function classifyReferralIntent(input: {
  message: string;
  care_need: string;
  candidate_count: number;
  top_facility_name?: string | null;
  model?: string;
}): Promise<'new_search' | 'follow_up'> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const lower = input.message.toLowerCase();
  if (/\bnear\b|\bfind\b|\bsearch\b|\bin\s+[a-z]/i.test(lower)) return 'new_search';

  try {
    const content = await invokeServingChat(
      [
        {
          role: 'system',
          content:
            'Classify the user message as new_search or follow_up about existing ranked referral results. Reply with only one token: new_search or follow_up.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: input.message,
            current_care_need: input.care_need,
            candidate_count: input.candidate_count,
            top_facility_name: input.top_facility_name,
          }),
        },
      ],
      { model, maxTokens: 16, temperature: 0 }
    );
    if (content.includes('new_search')) return 'new_search';
    return 'follow_up';
  } catch {
    return 'follow_up';
  }
}

export async function answerReferralFollowUp(input: {
  message: string;
  care_need: string;
  candidates: ReferralCandidate[];
  feedback_applied?: boolean;
  model?: string;
}): Promise<string> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  return invokeServingChat(
    [
      {
        role: 'system',
        content:
          'Answer follow-up questions about already-ranked referral candidates. Use only supplied JSON. Be concise and cautious. Not medical advice.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.message,
          care_need: input.care_need,
          feedback_applied: input.feedback_applied ?? false,
          candidates: input.candidates.slice(0, 8),
        }),
      },
    ],
    { model, maxTokens: 400, temperature: 0.2 }
  );
}
