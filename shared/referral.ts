/**
 * Shared Referral Copilot API types (server + client).
 * Lakebase SQL scoring returns the same ReferralCandidate contract.
 */

export type RankingPriority = 'prioritize_evidence' | 'prioritize_trust' | 'prioritize_distance';

export interface ReferralSearchParams {
  care_need: string;
  care_type: string;
  location_text?: string | null;
  user_lat: number;
  user_lon: number;
  ranking_priority: string;
  max_distance_km: number;
  top_n: number;
}

export interface EvidenceSnippet {
  field?: string | null;
  matched_terms?: string[];
  text?: string | null;
  confidence?: string | null;
  tier?: string | null;
  source_url?: string | null;
}

export interface ScoreBreakdownEntry {
  component?: string | null;
  raw?: number | null;
  weight?: number | null;
  contribution?: number | null;
}

export interface UrlClassification {
  facility_related?: string[];
  care_need_evidence?: string[];
  unrelated?: string[];
  unrelated_ratio?: number | null;
}

export interface ReferralCandidate {
  rank: number;
  facility_id: string;
  facility_name: string;
  clean_facility_type: string | null;
  clean_city: string | null;
  clean_district: string | null;
  clean_state: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
  raw_recommendation_score: number | null;
  final_recommendation_score: number | null;
  feedback_adjusted_score: number | null;
  feedback_delta: number | null;
  feedback_signals: string[] | null;
  feedback_reason: string | null;
  score_cap_reason: string | null;
  uncertainty_level: string | null;
  evidence_strength_score: number | null;
  disease_match_score: number | null;
  baseline_trust_score: number | null;
  local_need_score: number | null;
  score_breakdown: ScoreBreakdownEntry[] | Record<string, unknown> | null;
  recommendation_reason: string | null;
  evidence_snippets: EvidenceSnippet[];
  missing_evidence_flags: string[];
  suspicious_evidence_flags: string[];
  source_url_classification: UrlClassification | null;
  facility_related_urls: string[];
  care_need_evidence_urls: string[];
  unrelated_source_urls: string[];
  official_website?: string | null;
  official_phone?: string | null;
}

export interface ReferralSearchResponse {
  ok: true;
  scenario_id: string;
  feedback_applied: boolean;
  candidates: ReferralCandidate[];
}

export type ReviewDecision = 'accepted' | 'needs_verification' | 'rejected';

export interface ReferralParseResponseOk {
  ok: true;
  care_need: string;
  care_type: string;
  location_text: string | null;
  user_lat: number;
  user_lon: number;
  ranking_priority: string;
  max_distance_km: number;
  top_n: number;
  needs_clarification: null;
}

export interface ReferralParseResponseClarify {
  ok: false;
  kind: 'needs_clarification' | 'empty_message';
  needs_clarification?: 'location' | 'care_need' | 'both';
  message?: string;
  care_need?: string | null;
  care_type?: string | null;
  location_text?: string | null;
  user_lat?: number | null;
  user_lon?: number | null;
}

export interface ReferralBridgeError {
  ok: false;
  kind: string;
  error?: string;
  message?: string;
}

export type ReferralParseResponse =
  | ReferralParseResponseOk
  | ReferralParseResponseClarify
  | ReferralBridgeError;
