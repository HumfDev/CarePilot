/**
 * useReferralSearch — single source of truth for the Referral Copilot flow.
 *
 * Owns: search params, candidate list, scenario_id, current selection,
 * chat-style assistant transcript, and any in-flight/error state.
 *
 * Exposes:
 *   - submitMessage(text)   — parse + search in one go (chat submit)
 *   - rerunSearch()         — re-run with current params (after a feedback action)
 *   - selectCandidate(id)   — open detail card from ranked list
 *   - clearSelection()      — close the card
 *   - saveShortlist / saveNote / setReview / setOverride
 *                           — wrappers around the persistence endpoints
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ReferralCandidate,
  ReferralParseResponse,
  ReferralSearchParams,
  ReferralSearchResponse,
  ReferralSummarizer,
  ReviewDecision,
} from '../types/referral';
import { DEFAULT_REFERRAL_SUMMARIZER } from '../types/referral';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Optional structured payload (e.g. a search summary) the renderer can use. */
  meta?: Record<string, unknown>;
  createdAt: number;
}

interface UseReferralSearchOptions {
  initialAssistantGreeting?: string;
}

interface SearchActionState {
  loading: boolean;
  summarizing: boolean;
  error: string | null;
}

/** Default summarizer label shown in the UI when status has not loaded yet. */
export const DEFAULT_SUMMARIZER_LABEL = 'Genie';

const SUMMARIZER_STORAGE_KEY = 'carepilot:referral-summarizer';

function loadStoredSummarizer(): ReferralSummarizer {
  try {
    const stored = localStorage.getItem(SUMMARIZER_STORAGE_KEY);
    if (stored === 'llama' || stored === 'genie') return stored;
  } catch {
    // ignore
  }
  return DEFAULT_REFERRAL_SUMMARIZER;
}

export function summarizerDisplayName(
  summarizer: ReferralSummarizer,
  llamaModel = 'Llama 4 Maverick'
): string {
  return summarizer === 'genie' ? 'Genie' : llamaModel.replace(/^databricks-/, '').replace(/-/g, ' ');
}

async function fetchSearchSummary(
  params: ReferralSearchParams,
  candidates: ReferralCandidate[],
  feedbackApplied: boolean,
  summarizer: ReferralSummarizer
): Promise<{ text: string | null; engine: string }> {
  try {
    const res = await postJSON<{ ok: boolean; summary?: string; engine?: string; error?: string }>(
      '/api/referral/summarize-search',
      {
        care_need: params.care_need,
        care_type: params.care_type,
        location_text: params.location_text,
        candidates,
        feedback_applied: feedbackApplied,
        summarizer,
      }
    );
    if (res.ok && res.summary) {
      return { text: res.summary, engine: res.engine ?? 'genie' };
    }
    return { text: null, engine: 'template' };
  } catch {
    return { text: null, engine: 'template' };
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function chatSummary(params: ReferralSearchParams, candidates: ReferralCandidate[], feedbackApplied: boolean): string {
  if (!candidates.length) {
    return `No ${params.care_need} facilities found within ${params.max_distance_km.toFixed(0)} km of ${params.location_text ?? `${params.user_lat.toFixed(2)}, ${params.user_lon.toFixed(2)}`}. Try widening the search radius or a nearby city.`;
  }
  const top = candidates[0];
  const where = params.location_text ? ` near ${params.location_text}` : '';
  const topLine = `Top candidate for review: #1 ${top.facility_name} — score ${(top.feedback_adjusted_score ?? top.final_recommendation_score ?? 0).toFixed(1)}, ${(top.distance_km ?? 0).toFixed(1)} km, ${top.uncertainty_level ?? 'uncertainty n/a'}.`;
  const feedbackNote = feedbackApplied ? ' Feedback-aware re-ranking is active for this scenario.' : '';
  return `I found ${candidates.length} candidate facilities for ${params.care_need}${where}. ${topLine} Open a marker or list row for the evidence and verification notes. Not medical advice — verify before referral.${feedbackNote}`;
}

function searchParamsMatch(a: ReferralSearchParams, b: ReferralSearchParams): boolean {
  const locA = (a.location_text ?? '').trim().toLowerCase();
  const locB = (b.location_text ?? '').trim().toLowerCase();
  const sameLocation =
    (locA.length > 0 && locA === locB) ||
    (Math.abs(a.user_lat - b.user_lat) < 0.05 && Math.abs(a.user_lon - b.user_lon) < 0.05);
  return (
    a.care_need.trim().toLowerCase() === b.care_need.trim().toLowerCase() &&
    a.care_type === b.care_type &&
    sameLocation &&
    a.ranking_priority === b.ranking_priority &&
    Math.abs(a.max_distance_km - b.max_distance_km) < 0.5 &&
    a.top_n === b.top_n
  );
}

function alreadyShownSummaryMessage(params: ReferralSearchParams, count: number): string {
  const where = params.location_text ? ` near ${params.location_text}` : '';
  return `Those ${count} ${params.care_need} results${where} are already on the map and ranked list. Open a row for evidence, or ask a follow-up like "why is #2 ranked below #1?"`;
}

function followupFallback(message: string, candidates: ReferralCandidate[]): string {
  const top = candidates[0];
  const score = top.feedback_adjusted_score ?? top.final_recommendation_score ?? 0;
  return `I still have ${candidates.length} ranked candidates loaded. #1 is ${top.facility_name} (score ${score.toFixed(1)}). Open a list row for full evidence. To search a different city or care need, try a new request like "cardiology near Mumbai". You asked: "${message}"`;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned non-JSON for ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok && (parsed as { ok?: boolean })?.ok !== false) {
    throw new Error(`HTTP ${res.status} on ${path}`);
  }
  return parsed as T;
}

async function fetchMessageIntent(
  message: string,
  params: ReferralSearchParams,
  candidates: ReferralCandidate[],
  summarizer: ReferralSummarizer
): Promise<'new_search' | 'follow_up' | null> {
  try {
    const res = await postJSON<{ ok: boolean; intent?: 'new_search' | 'follow_up' }>(
      '/api/referral/classify-intent',
      {
        message,
        care_need: params.care_need,
        care_type: params.care_type,
        location_text: params.location_text,
        candidate_count: candidates.length,
        top_facility_name: candidates[0]?.facility_name ?? null,
        summarizer,
      }
    );
    if (res.ok && res.intent) return res.intent;
    return null;
  } catch {
    return null;
  }
}

async function fetchFollowupReply(
  message: string,
  params: ReferralSearchParams,
  candidates: ReferralCandidate[],
  feedbackApplied: boolean,
  summarizer: ReferralSummarizer
): Promise<{ text: string | null; engine: string }> {
  try {
    const res = await postJSON<{ ok: boolean; reply?: string; engine?: string }>('/api/referral/chat', {
      message,
      care_need: params.care_need,
      care_type: params.care_type,
      location_text: params.location_text,
      candidates,
      feedback_applied: feedbackApplied,
      summarizer,
    });
    if (res.ok && res.reply) {
      return { text: res.reply, engine: res.engine ?? 'genie' };
    }
    return { text: null, engine: 'template' };
  } catch {
    return { text: null, engine: 'template' };
  }
}

export function useReferralSearch(options: UseReferralSearchOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const greeting =
      options.initialAssistantGreeting ??
      'Type a referral request like "dialysis near Jaipur". I rank candidates with our evidence pipeline, then explain results with Databricks Genie — verify before referral.';
    return [
      {
        id: newId('msg'),
        role: 'assistant',
        text: greeting,
        createdAt: Date.now(),
      },
    ];
  });

  const [searchParams, setSearchParams] = useState<ReferralSearchParams | null>(null);
  const [candidates, setCandidates] = useState<ReferralCandidate[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [feedbackApplied, setFeedbackApplied] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchActionState>({
    loading: false,
    summarizing: false,
    error: null,
  });
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [summarizer, setSummarizerState] = useState<ReferralSummarizer>(() => loadStoredSummarizer());
  const [genieEnabled, setGenieEnabled] = useState(true);
  const [llamaModel, setLlamaModel] = useState('databricks-llama-4-maverick');

  useEffect(() => {
    void fetch('/api/referral/status')
      .then((r) => r.json())
      .then(
        (data: {
          genie_enabled?: boolean;
          llama_model?: string;
        }) => {
          if (typeof data.genie_enabled === 'boolean') setGenieEnabled(data.genie_enabled);
          if (typeof data.llama_model === 'string') setLlamaModel(data.llama_model);
          if (data.genie_enabled === false) {
            setSummarizerState((current) => (current === 'genie' ? 'llama' : current));
          }
        }
      )
      .catch(() => {
        // local demo may not expose status fully
      });
  }, []);

  const setSummarizer = useCallback((next: ReferralSummarizer) => {
    setSummarizerState(next);
    try {
      localStorage.setItem(SUMMARIZER_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const summarizerLabel = useMemo(
    () => summarizerDisplayName(summarizer, llamaModel),
    [summarizer, llamaModel]
  );

  const appendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'createdAt'>) => {
    setMessages((prev) => [...prev, { ...message, id: newId('msg'), createdAt: Date.now() }]);
  }, []);

  const answerFollowUp = useCallback(
    async (text: string): Promise<void> => {
      if (!searchParams || candidates.length === 0) return;
      setSearch((prev) => ({ ...prev, summarizing: true, error: null }));
      const reply = await fetchFollowupReply(text, searchParams, candidates, feedbackApplied, summarizer);
      appendMessage({
        role: 'assistant',
        text: reply.text ?? followupFallback(text, candidates),
        meta: { kind: 'followup', model: reply.engine },
      });
      setSearch((prev) => ({ ...prev, summarizing: false }));
    },
    [appendMessage, searchParams, candidates, feedbackApplied, summarizer]
  );

  const runSearch = useCallback(
    async (params: ReferralSearchParams, opts: { quiet?: boolean } = {}): Promise<void> => {
      setSearch({ loading: true, summarizing: false, error: null });
      try {
        const res = await postJSON<ReferralSearchResponse | { ok: false; error?: string }>('/api/referral/search', {
          ...params,
          use_feedback_reranking: true,
        });
        if (!('ok' in res) || res.ok !== true) {
          const errMessage = (res as { error?: string }).error ?? 'Search failed.';
          setSearch({ loading: false, summarizing: false, error: errMessage });
          if (!opts.quiet) {
            appendMessage({ role: 'assistant', text: `Search failed: ${errMessage}` });
          }
          return;
        }
        const nextCandidates = res.candidates ?? [];
        const dataMessage =
          res.data_not_ready && typeof res.message === 'string'
            ? res.message
            : null;
        setSearchParams(params);
        setCandidates(nextCandidates);
        setScenarioId(res.scenario_id ?? null);
        setFeedbackApplied(!!res.feedback_applied);
        setSelectedCandidateId((prev) => {
          if (!prev) return null;
          return nextCandidates.some((c) => c.facility_id === prev) ? prev : null;
        });
        setSearch({ loading: false, summarizing: !opts.quiet, error: null });
        if (!opts.quiet) {
          if (dataMessage) {
            appendMessage({
              role: 'assistant',
              text: dataMessage,
              meta: { kind: 'data_not_ready' },
            });
            setSearch({ loading: false, summarizing: false, error: null });
            return;
          }
          const summary = await fetchSearchSummary(
            params,
            res.candidates ?? [],
            !!res.feedback_applied,
            summarizer
          );
          appendMessage({
            role: 'assistant',
            text: summary.text ?? chatSummary(params, res.candidates ?? [], !!res.feedback_applied),
            meta: {
              scenario_id: res.scenario_id,
              candidates: res.candidates?.length ?? 0,
              model: summary.text ? summary.engine : 'template',
            },
          });
        }
        setSearch({ loading: false, summarizing: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Search failed.';
        setSearch({ loading: false, summarizing: false, error: message });
        if (!opts.quiet) appendMessage({ role: 'assistant', text: `Search failed: ${message}` });
      }
    },
    [appendMessage, summarizer]
  );

  const submitMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      appendMessage({ role: 'user', text: trimmed });

      if (searchParams && candidates.length > 0) {
        setSearch((prev) => ({ ...prev, summarizing: true, error: null }));
        const intent = await fetchMessageIntent(trimmed, searchParams, candidates, summarizer);
        if (intent === 'follow_up') {
          await answerFollowUp(trimmed);
          return;
        }
        setSearch((prev) => ({ ...prev, summarizing: false }));
      }

      let parsed: ReferralParseResponse;
      try {
        parsed = await postJSON<ReferralParseResponse>('/api/referral/parse', { message: trimmed });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not parse message.';
        appendMessage({ role: 'assistant', text: `I could not reach the parser: ${message}` });
        return;
      }

      if (!parsed.ok) {
        if (searchParams && candidates.length > 0) {
          await answerFollowUp(trimmed);
          return;
        }

        const fallback =
          parsed.message ??
          'I could not extract a care need and location. Try "dialysis near Jaipur" or "cardiology near Mumbai".';
        appendMessage({ role: 'assistant', text: fallback });
        return;
      }

      const params: ReferralSearchParams = {
        care_need: parsed.care_need,
        care_type: parsed.care_type,
        location_text: parsed.location_text,
        user_lat: parsed.user_lat,
        user_lon: parsed.user_lon,
        ranking_priority: parsed.ranking_priority,
        max_distance_km: parsed.max_distance_km,
        top_n: parsed.top_n,
      };

      if (searchParams && candidates.length > 0 && searchParamsMatch(params, searchParams)) {
        appendMessage({
          role: 'assistant',
          text: alreadyShownSummaryMessage(searchParams, candidates.length),
          meta: { kind: 'duplicate_search' },
        });
        return;
      }

      await runSearch(params);
    },
    [appendMessage, runSearch, searchParams, candidates, answerFollowUp, summarizer]
  );

  const rerunSearch = useCallback(async (): Promise<void> => {
    if (!searchParams) return;
    await runSearch(searchParams, { quiet: true });
  }, [runSearch, searchParams]);

  /** Same pipeline as chat — parse + Python evidence search. */
  const searchFromSidebar = useCallback(
    async (input: {
      city: string;
      careNeed: string;
      plannerLocation?: { lat: number; lon: number } | null;
    }): Promise<void> => {
      const city = input.city.trim();
      const careNeed = input.careNeed.trim();
      if (!city) {
        setSearch((prev) => ({ ...prev, error: 'Enter a city (e.g. Jaipur).' }));
        return;
      }

      const message = careNeed ? `${careNeed} near ${city}` : `healthcare near ${city}`;
      appendMessage({ role: 'user', text: message });

      let parsed: ReferralParseResponse;
      try {
        parsed = await postJSON<ReferralParseResponse>('/api/referral/parse', { message });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Could not parse search.';
        setSearch({ loading: false, summarizing: false, error: errMsg });
        appendMessage({ role: 'assistant', text: `Search failed: ${errMsg}` });
        return;
      }

      if (!parsed.ok) {
        const fallback =
          parsed.message ?? 'Could not parse city and care need. Try "dialysis near Jaipur".';
        setSearch({ loading: false, summarizing: false, error: null });
        appendMessage({ role: 'assistant', text: fallback });
        return;
      }

      const params: ReferralSearchParams = {
        care_need: parsed.care_need,
        care_type: parsed.care_type,
        location_text: parsed.location_text,
        user_lat: parsed.user_lat,
        user_lon: parsed.user_lon,
        ranking_priority: parsed.ranking_priority,
        max_distance_km: parsed.max_distance_km,
        top_n: parsed.top_n,
      };

      if (input.plannerLocation) {
        params.user_lat = input.plannerLocation.lat;
        params.user_lon = input.plannerLocation.lon;
      }

      if (searchParams && candidates.length > 0 && searchParamsMatch(params, searchParams)) {
        appendMessage({
          role: 'assistant',
          text: alreadyShownSummaryMessage(searchParams, candidates.length),
          meta: { kind: 'duplicate_search' },
        });
        return;
      }

      await runSearch(params);
    },
    [appendMessage, runSearch, searchParams, candidates],
  );

  const clearSearch = useCallback(() => {
    setCandidates([]);
    setSearchParams(null);
    setScenarioId(null);
    setFeedbackApplied(false);
    setSelectedCandidateId(null);
    setSearch({ loading: false, summarizing: false, error: null });
  }, []);

  const persistAndRerun = useCallback(
    async (label: string, path: string, body: unknown): Promise<void> => {
      setActionPending(label);
      try {
        await postJSON<{ ok: boolean; error?: string }>(path, body);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed.';
        appendMessage({ role: 'assistant', text: `Could not ${label.toLowerCase()}: ${message}` });
      } finally {
        setActionPending(null);
      }
      await rerunSearch();
    },
    [appendMessage, rerunSearch]
  );

  const saveShortlist = useCallback(
    (candidate: ReferralCandidate) => {
      if (!scenarioId) return Promise.resolve();
      return persistAndRerun('Save to shortlist', '/api/referral/shortlist', {
        scenario_id: scenarioId,
        candidate: {
          facility_id: candidate.facility_id,
          facility_name: candidate.facility_name,
          final_recommendation_score: candidate.final_recommendation_score,
          uncertainty_level: candidate.uncertainty_level,
          distance_km: candidate.distance_km,
        },
      });
    },
    [persistAndRerun, scenarioId]
  );

  const saveNote = useCallback(
    (candidate: ReferralCandidate, note: string) => {
      if (!scenarioId) return Promise.resolve();
      return persistAndRerun('Save note', '/api/referral/note', {
        scenario_id: scenarioId,
        facility_id: candidate.facility_id,
        note,
      });
    },
    [persistAndRerun, scenarioId]
  );

  const setReview = useCallback(
    (candidate: ReferralCandidate, status: ReviewDecision) => {
      if (!scenarioId) return Promise.resolve();
      return persistAndRerun('Set review decision', '/api/referral/review', {
        scenario_id: scenarioId,
        facility_id: candidate.facility_id,
        status,
        reviewer: 'planner',
      });
    },
    [persistAndRerun, scenarioId]
  );

  const setOverride = useCallback(
    (candidate: ReferralCandidate, overrideScore: number, reason: string) => {
      if (!scenarioId) return Promise.resolve();
      return persistAndRerun('Save override', '/api/referral/override', {
        scenario_id: scenarioId,
        facility_id: candidate.facility_id,
        original_score: candidate.final_recommendation_score ?? 0,
        override_score: overrideScore,
        reason,
      });
    },
    [persistAndRerun, scenarioId]
  );

  const userLocation = useMemo(
    () => (searchParams ? { lat: searchParams.user_lat, lon: searchParams.user_lon } : null),
    [searchParams]
  );

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.facility_id === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId]
  );

  return {
    messages,
    appendMessage,
    searchParams,
    candidates,
    scenarioId,
    feedbackApplied,
    selectedCandidateId,
    selectedCandidate,
    userLocation,
    search,
    actionPending,
    summarizer,
    setSummarizer,
    summarizerLabel,
    genieEnabled,
    llamaModel,
    submitMessage,
    searchFromSidebar,
    clearSearch,
    rerunSearch,
    selectCandidate: setSelectedCandidateId,
    clearSelection: () => setSelectedCandidateId(null),
    saveShortlist,
    saveNote,
    setReview,
    setOverride,
  };
}

export type UseReferralSearchReturn = ReturnType<typeof useReferralSearch>;
