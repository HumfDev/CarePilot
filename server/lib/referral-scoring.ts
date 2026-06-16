import type { ReferralCandidate, ScoreBreakdownEntry } from '../../shared/referral';

export interface FacilityRow {
  facility_id: string;
  facility_name: string;
  latitude: number;
  longitude: number;
  clean_city: string | null;
  clean_district: string | null;
  clean_state: string | null;
  clean_facility_type: string | null;
  description: string | null;
  specialties: string | null;
  capability: string | null;
  procedure: string | null;
  equipment: string | null;
  source_urls: string | null;
  trust_score_v2: number | null;
  info_richness_score: number | null;
  source_count: number | null;
  official_website: string | null;
  official_phone: string | null;
  institutional_birth_5y_pct: number | null;
  m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct: number | null;
  w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct: number | null;
  child_u5_who_are_stunted_height_for_age_18_pct: number | null;
  child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct: number | null;
  hh_member_covered_health_insurance_pct: number | null;
}

export interface SearchScoreInput {
  care_need: string;
  care_type: string;
  ranking_priority: string;
  user_lat: number;
  user_lon: number;
  max_distance_km: number;
  top_n: number;
}

const CONDITION_KEYWORDS: Record<string, string[]> = {
  dialysis: ['dialysis', 'hemodialysis', 'nephrology', 'renal', 'kidney'],
  heart: ['cardiology', 'cardiac', 'heart', 'ecg', 'coronary'],
  pregnancy: ['maternity', 'pregnancy', 'obstetrics', 'gynecology', 'delivery', 'antenatal'],
  emergency: ['emergency', 'trauma', 'icu', 'casualty', 'ambulance'],
  cancer: ['oncology', 'cancer', 'chemotherapy', 'radiotherapy', 'tumor', 'tumour'],
  diabetes: ['diabetes', 'diabetic', 'endocrinology', 'blood sugar'],
  child: ['pediatric', 'paediatric', 'neonatal', 'child'],
  surgery: ['surgery', 'surgical', 'operation'],
  general: ['general', 'medicine', 'clinic', 'opd'],
};

const FEEDBACK_BOOSTS = {
  shortlist: 8,
  reviewed: 5,
  needs_verification: 2,
  note: 1,
  rejected_penalty: 30,
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function distanceScore(km: number, careType: string): number {
  const buckets =
    careType === 'emergency'
      ? [
          [5, 100],
          [15, 90],
          [30, 75],
          [50, 55],
          [100, 30],
        ]
      : [
          [10, 100],
          [25, 85],
          [50, 70],
          [100, 45],
          [9999, 20],
        ];
  for (const [limit, score] of buckets) {
    if (km <= limit) return score;
  }
  return 20;
}

function medicalText(row: FacilityRow): string {
  return [row.description, row.specialties, row.capability, row.procedure, row.equipment]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function diseaseMatchScore(row: FacilityRow, careNeed: string): number {
  const keywords = CONDITION_KEYWORDS[careNeed] ?? [careNeed];
  const text = medicalText(row);
  if (!text) return 0;
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) hits += 1;
  }
  if (hits === 0) return 0;
  return Math.min(100, 35 + hits * 20);
}

function localNeedScore(row: FacilityRow, careNeed: string): number {
  const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Number(v));
  if (careNeed === 'diabetes') {
    const v = pct(row.m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct);
    return v == null ? 50 : Math.min(100, Math.max(0, v));
  }
  if (careNeed === 'heart') {
    const v = pct(row.w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct);
    return v == null ? 50 : Math.min(100, Math.max(0, v));
  }
  if (careNeed === 'pregnancy') {
    const v = pct(row.institutional_birth_5y_pct);
    return v == null ? 50 : Math.min(100, Math.max(0, 100 - v));
  }
  if (careNeed === 'child') {
    const st = pct(row.child_u5_who_are_stunted_height_for_age_18_pct);
    const an = pct(row.child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct);
    if (st == null && an == null) return 50;
    return Math.min(100, Math.max(0, ((st ?? 0) + (an ?? 0)) / 2));
  }
  const ins = pct(row.hh_member_covered_health_insurance_pct);
  return ins == null ? 50 : Math.min(100, Math.max(0, 100 - ins));
}

function evidenceStrengthScore(row: FacilityRow, careNeed: string): {
  score: number;
  snippets: ReferralCandidate['evidence_snippets'];
  missing: string[];
  suspicious: string[];
} {
  const snippets: ReferralCandidate['evidence_snippets'] = [];
  const missing: string[] = [];
  const suspicious: string[] = [];
  const keywords = CONDITION_KEYWORDS[careNeed] ?? [careNeed];
  const fields: Array<[string, string | null]> = [
    ['specialties', row.specialties],
    ['equipment', row.equipment],
    ['procedure', row.procedure],
    ['capability', row.capability],
    ['description', row.description],
  ];

  let directHits = 0;
  for (const [field, text] of fields) {
    if (!text?.trim()) {
      missing.push(`missing_${field}`);
      continue;
    }
    const lower = text.toLowerCase();
    const matched = keywords.filter((k) => lower.includes(k));
    if (matched.length) {
      directHits += 1;
      snippets.push({
        field,
        matched_terms: matched,
        text: text.slice(0, 180),
        confidence: field === 'specialties' || field === 'equipment' ? 'direct' : 'related',
        tier: field === 'specialties' ? 'primary' : 'supporting',
      });
    }
  }

  if (!row.source_urls?.trim()) missing.push('missing_source_urls');
  if ((row.source_count ?? 0) < 1) suspicious.push('low_source_count');

  let score = 20 + directHits * 18 + Math.min(25, (row.info_richness_score ?? 0) * 0.25);
  if (!snippets.length) score = Math.min(score, 30);
  return { score: Math.min(100, score), snippets, missing, suspicious };
}

function uncertaintyLevel(evidenceScore: number, suspicious: string[]): string {
  if (evidenceScore >= 65 && suspicious.length === 0) return 'Low uncertainty';
  if (evidenceScore >= 35) return 'Medium uncertainty';
  return 'High uncertainty';
}

function uncertaintyPenalty(level: string): number {
  if (level.startsWith('Low')) return 5;
  if (level.startsWith('Medium')) return 35;
  return 70;
}

function getWeights(careType: string, priority: string) {
  const base: Record<string, number> =
    careType === 'emergency'
      ? { distance: 0.35, condition: 0.2, trust: 0.15, evidence: 0.2, local_need: 0.05, uncertainty: 0.05 }
      : careType === 'general'
        ? { distance: 0.25, condition: 0.2, trust: 0.25, evidence: 0.2, local_need: 0.05, uncertainty: 0.05 }
        : careType === 'maternity'
          ? { distance: 0.25, condition: 0.25, trust: 0.2, evidence: 0.2, local_need: 0.05, uncertainty: 0.05 }
          : { distance: 0.15, condition: 0.3, trust: 0.2, evidence: 0.25, local_need: 0.05, uncertainty: 0.05 };

  if (priority === 'prioritize_distance') base.distance *= 2.5;
  if (priority === 'prioritize_trust') base.trust *= 2.5;
  if (priority === 'prioritize_evidence') {
    base.condition *= 1.5;
    base.evidence *= 2.5;
  }

  const positive = base.distance + base.condition + base.trust + base.evidence + base.local_need;
  const scale = 1 / positive;
  return {
    distance: base.distance * scale,
    condition: base.condition * scale,
    trust: base.trust * scale,
    evidence: base.evidence * scale,
    local_need: base.local_need * scale,
    uncertainty: base.uncertainty,
  };
}

function applySafetyCaps(raw: number, evidenceScore: number, snippets: number, uncertainty: string): {
  final: number;
  capReason: string | null;
} {
  let final = raw;
  let capReason: string | null = null;
  const cap = (limit: number, reason: string) => {
    if (final > limit) {
      final = limit;
      capReason = reason;
    }
  };
  if (uncertainty.startsWith('High')) cap(70, 'soft-capped near 70 because uncertainty is High');
  if (evidenceScore < 35) cap(65, 'soft-capped near 65 because evidence strength is below 35');
  if (snippets === 0) cap(55, 'soft-capped near 55 because no direct evidence snippets were found');
  return { final: Math.max(0, Math.min(100, final)), capReason };
}

function splitUrls(sourceUrls: string | null): string[] {
  if (!sourceUrls) return [];
  return sourceUrls
    .split(/[|,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('http'));
}

export function scoreFacilityRow(row: FacilityRow, input: SearchScoreInput): Omit<ReferralCandidate, 'rank'> {
  const distanceKm = haversineKm(input.user_lat, input.user_lon, row.latitude, row.longitude);
  const distScore = distanceScore(distanceKm, input.care_type);
  const diseaseScore = diseaseMatchScore(row, input.care_need);
  const trustScore = row.trust_score_v2 ?? 50;
  const localScore = localNeedScore(row, input.care_need);
  const evidence = evidenceStrengthScore(row, input.care_need);
  const uncertainty = uncertaintyLevel(evidence.score, evidence.suspicious);
  const uPenalty = uncertaintyPenalty(uncertainty);
  const weights = getWeights(input.care_type, input.ranking_priority);

  const raw =
    weights.distance * distScore +
    weights.condition * diseaseScore +
    weights.trust * trustScore +
    weights.evidence * evidence.score +
    weights.local_need * localScore -
    weights.uncertainty * uPenalty;

  const capped = applySafetyCaps(raw, evidence.score, evidence.snippets.length, uncertainty);
  const breakdown: ScoreBreakdownEntry[] = [
    { component: 'distance', raw: distScore, weight: weights.distance, contribution: weights.distance * distScore },
    { component: 'disease_match', raw: diseaseScore, weight: weights.condition, contribution: weights.condition * diseaseScore },
    { component: 'trust', raw: trustScore, weight: weights.trust, contribution: weights.trust * trustScore },
    { component: 'evidence', raw: evidence.score, weight: weights.evidence, contribution: weights.evidence * evidence.score },
    { component: 'local_need', raw: localScore, weight: weights.local_need, contribution: weights.local_need * localScore },
    { component: 'uncertainty_penalty', raw: uPenalty, weight: weights.uncertainty, contribution: -weights.uncertainty * uPenalty },
  ];

  const urls = splitUrls(row.source_urls);
  const reason = `Evidence-aware score ${capped.final.toFixed(1)} for ${input.care_need} at ${distanceKm.toFixed(1)} km — trust ${trustScore.toFixed(0)}, disease match ${diseaseScore.toFixed(0)}, evidence ${evidence.score.toFixed(0)}. Verify before referral.`;

  return {
    facility_id: row.facility_id,
    facility_name: row.facility_name,
    clean_facility_type: row.clean_facility_type,
    clean_city: row.clean_city,
    clean_district: row.clean_district,
    clean_state: row.clean_state,
    latitude: row.latitude,
    longitude: row.longitude,
    distance_km: distanceKm,
    raw_recommendation_score: raw,
    final_recommendation_score: capped.final,
    feedback_adjusted_score: null,
    feedback_delta: null,
    feedback_signals: null,
    feedback_reason: null,
    score_cap_reason: capped.capReason,
    uncertainty_level: uncertainty,
    evidence_strength_score: evidence.score,
    disease_match_score: diseaseScore,
    baseline_trust_score: trustScore,
    local_need_score: localScore,
    score_breakdown: breakdown,
    recommendation_reason: reason,
    evidence_snippets: evidence.snippets,
    missing_evidence_flags: evidence.missing,
    suspicious_evidence_flags: evidence.suspicious,
    source_url_classification: {
      facility_related: urls.slice(0, 5),
      care_need_evidence: evidence.snippets.map((s) => s.source_url).filter(Boolean) as string[],
      unrelated: [],
      unrelated_ratio: urls.length ? 0 : null,
    },
    facility_related_urls: urls.slice(0, 5),
    care_need_evidence_urls: [],
    unrelated_source_urls: [],
    official_website: row.official_website,
    official_phone: row.official_phone,
  };
}

export interface WorkspaceFeedback {
  shortlisted_facility_ids: string[];
  notes_by_facility_id: Record<string, string[]>;
  decisions_by_facility_id: Record<string, string>;
  overrides_by_facility_id: Record<string, { override_score: number; override_reason?: string }>;
}

export function applyFeedbackReranking(
  candidates: ReferralCandidate[],
  feedback: WorkspaceFeedback
): ReferralCandidate[] {
  const shortlisted = new Set(feedback.shortlisted_facility_ids);
  const notes = feedback.notes_by_facility_id ?? {};
  const decisions = feedback.decisions_by_facility_id ?? {};
  const overrides = feedback.overrides_by_facility_id ?? {};

  const adjusted = candidates.map((c) => {
    const base = c.final_recommendation_score ?? 0;
    const signals: string[] = [];
    const reasons: string[] = [];
    let delta = 0;

    const override = overrides[c.facility_id];
    if (override) {
      const adj = override.override_score;
      return {
        ...c,
        feedback_adjusted_score: adj,
        feedback_delta: adj - base,
        feedback_signals: ['manual_override'],
        feedback_reason: `Manual override applied: ${override.override_reason ?? 'planner override'}. Verify before referral.`,
      };
    }

    if (shortlisted.has(c.facility_id)) {
      delta += FEEDBACK_BOOSTS.shortlist;
      signals.push('shortlisted');
      reasons.push('saved to the shortlist');
    }
    const decision = decisions[c.facility_id];
    if (decision === 'accepted') {
      delta += FEEDBACK_BOOSTS.reviewed;
      signals.push('reviewed');
      reasons.push('previously accepted by the planner');
    } else if (decision === 'needs_verification') {
      delta += FEEDBACK_BOOSTS.needs_verification;
      signals.push('needs_verification');
      reasons.push('flagged for verification');
    } else if (decision === 'rejected') {
      delta -= FEEDBACK_BOOSTS.rejected_penalty;
      signals.push('rejected');
      reasons.push('previously rejected by the planner');
    }
    if ((notes[c.facility_id]?.length ?? 0) > 0) {
      delta += FEEDBACK_BOOSTS.note;
      signals.push('has_notes');
      reasons.push('has planner notes');
    }

    const adj = Math.max(0, Math.min(100, base + delta));
    const feedbackReason =
      signals.length === 0
        ? 'No prior planner feedback for this facility. Ranking is based only on evidence-aware score.'
        : `Feedback-adjusted score ${signals.includes('rejected') ? 'decreased' : 'increased'} from ${base.toFixed(1)} to ${adj.toFixed(1)} because this facility was ${reasons.join(' and ')}. Verify before referral.`;

    return {
      ...c,
      feedback_adjusted_score: adj,
      feedback_delta: adj - base,
      feedback_signals: signals,
      feedback_reason: feedbackReason,
    };
  });

  return adjusted.sort(
    (a, b) =>
      (b.feedback_adjusted_score ?? b.final_recommendation_score ?? 0) -
      (a.feedback_adjusted_score ?? a.final_recommendation_score ?? 0)
  );
}

export function rankFacilityRows(rows: FacilityRow[], input: SearchScoreInput): ReferralCandidate[] {
  const within = rows
    .map((row) => scoreFacilityRow(row, input))
    .filter((c) => (c.distance_km ?? 999) <= input.max_distance_km)
    .sort((a, b) => (b.final_recommendation_score ?? 0) - (a.final_recommendation_score ?? 0))
    .slice(0, input.top_n);

  return within.map((c, i) => ({ ...c, rank: i + 1 }));
}
