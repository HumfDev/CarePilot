/**
 * Facility ranking algorithm — TypeScript port of the backend
 * facility_scoring_pipeline.py (carepilot Track 3 Referral Copilot).
 *
 * Score = w_distance·distance_score + w_condition·condition_score
 *       + w_trust·trust_score + w_evidence·evidence_score + w_local_need·50
 *
 * trust_score  → trust_score_v2 from the DB (PERCENT_RANK composite 0–100)
 * evidence_score → source_credibility_score × 100 from DB, else text richness
 * condition_score → tiered keyword match over specialties/capability/procedure/equipment/description
 * local_need fixed at 50 (neutral) because NFHS columns aren't fetched here
 */

import type { FacilityNode } from '../types/facility';

// ---------------------------------------------------------------------------
// Distance buckets — identical to backend _DISTANCE_BUCKETS
// ---------------------------------------------------------------------------

const DISTANCE_BUCKETS: Record<string, Array<[number, number]>> = {
  emergency: [[2, 100], [5, 85], [10, 60], [20, 35], [Infinity, 10]],
  general:   [[5, 100], [10, 85], [25, 65], [50, 40], [Infinity, 15]],
  specialist:[[10, 100], [25, 85], [50, 70], [100, 45], [Infinity, 20]],
};

export function computeDistanceScore(distanceKm: number, careType: string): number {
  const buckets = DISTANCE_BUCKETS[careType] ?? DISTANCE_BUCKETS.general;
  for (const [upper, score] of buckets) {
    if (distanceKm <= upper) return score;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Disease keyword tables — from backend DISEASE_KEYWORDS + KEYWORD_WEIGHTS
// ---------------------------------------------------------------------------

export const DISEASE_KEYWORDS: Record<string, string[]> = {
  diabetes:     ['diabetes', 'diabetic', 'blood sugar', 'glucose', 'endocrinology', 'endocrine', 'internal medicine'],
  hypertension: ['hypertension', 'high blood pressure', 'blood pressure', 'cardiology', 'cardiac', 'heart'],
  heart:        ['cardiology', 'cardiac', 'heart', 'ecg', 'echo', 'angiography', 'angioplasty', 'chest pain'],
  pregnancy:    ['maternity', 'pregnancy', 'obstetrics', 'gynecology', 'gynaecology', 'delivery', 'birth', 'labor room', 'nicu'],
  emergency:    ['emergency', 'trauma', 'icu', 'ambulance', 'casualty', 'critical care', '24 hours', '24/7'],
  cancer:       ['oncology', 'cancer', 'tumor', 'chemotherapy', 'radiation', 'radiotherapy'],
  kidney:       ['nephrology', 'kidney', 'renal', 'dialysis', 'urology', 'hemodialysis'],
  child:        ['pediatrics', 'paediatrics', 'child', 'children', 'neonatal', 'nicu'],
  surgery:      ['surgery', 'surgeon', 'operation', 'operating theatre', 'ot', 'general surgery'],
  diagnostics:  ['diagnostic', 'laboratory', 'lab', 'pathology', 'x-ray', 'mri', 'ct scan', 'ultrasound'],
  dialysis:     ['dialysis', 'hemodialysis', 'haemodialysis', 'nephrology', 'renal'],
};

const KEYWORD_WEIGHTS: Record<string, number> = {
  'cardiology': 2.0, 'cardiac': 1.8, 'echo': 1.5, 'ecg': 1.4,
  'angiography': 2.0, 'angioplasty': 2.2,
  'endocrinology': 2.2, 'endocrine': 1.8,
  'diabetes': 2.0, 'diabetic': 1.8, 'hypertension': 2.2,
  'obstetrics': 2.0, 'gynecology': 1.8, 'gynaecology': 1.8,
  'maternity': 2.0, 'pregnancy': 1.8, 'delivery': 1.4,
  'labor room': 2.0, 'birth': 1.0, 'nicu': 2.4, 'neonatal': 2.0,
  'pediatrics': 2.0, 'paediatrics': 2.0,
  'emergency': 2.2, 'trauma': 2.0, 'icu': 2.0, 'casualty': 1.8,
  'critical care': 2.2, 'ambulance': 1.4, '24 hours': 1.6, '24/7': 1.6,
  'oncology': 2.4, 'cancer': 2.0, 'tumor': 1.6,
  'chemotherapy': 2.4, 'radiation': 1.8, 'radiotherapy': 2.4,
  'nephrology': 2.4, 'kidney': 1.6, 'renal': 1.8,
  'dialysis': 2.4, 'hemodialysis': 2.6, 'haemodialysis': 2.6, 'urology': 1.8,
  'diagnostic': 1.4, 'pathology': 1.6, 'x-ray': 1.4,
  'mri': 1.8, 'ct scan': 1.8, 'ultrasound': 1.4, 'imaging': 1.4,
  'surgery': 1.2, 'surgeon': 1.2, 'general surgery': 1.6,
  'operating theatre': 1.6, 'operation': 1.2, 'ot': 0.8,
  'heart': 1.2, 'blood pressure': 1.3, 'high blood pressure': 1.6,
  'blood sugar': 1.6, 'glucose': 1.4,
  'internal medicine': 1.5, 'medicine': 0.6,
  'child': 0.8, 'children': 0.8,
  'laboratory': 1.2, 'lab': 0.8, 'chest pain': 1.6,
};

// Free-text → canonical condition key — from backend CARE_NEED_ALIASES
const CARE_NEED_ALIASES: Record<string, string> = {
  'emergency surgery': 'emergency', 'emergency care': 'emergency', 'trauma': 'emergency',
  'icu': 'emergency', 'casualty': 'emergency', 'critical care': 'emergency', '24/7': 'emergency',
  'cardiology': 'heart', 'cardiac': 'heart', 'chest pain': 'heart', 'ecg': 'heart', 'echo': 'heart',
  'angiography': 'heart', 'angioplasty': 'heart',
  'maternity': 'pregnancy', 'maternal': 'pregnancy', 'maternal care': 'pregnancy',
  'obstetrics': 'pregnancy', 'gynaecology': 'pregnancy', 'gynecology': 'pregnancy',
  'labor': 'pregnancy', 'labour': 'pregnancy', 'delivery': 'pregnancy',
  'pediatric': 'child', 'paediatric': 'child', 'pediatrics': 'child', 'paediatrics': 'child',
  'kids': 'child', 'neonatal': 'child', 'nicu': 'child',
  'kidney': 'dialysis', 'nephrology': 'dialysis', 'renal': 'dialysis',
  'hemodialysis': 'dialysis', 'haemodialysis': 'dialysis',
  'oncology': 'cancer', 'tumor': 'cancer', 'tumour': 'cancer',
  'chemo': 'cancer', 'chemotherapy': 'cancer', 'radiotherapy': 'cancer',
  'blood sugar': 'diabetes', 'endocrinology': 'diabetes',
  'blood pressure': 'hypertension', 'high blood pressure': 'hypertension', 'bp': 'hypertension',
  'mri': 'diagnostics', 'ct scan': 'diagnostics', 'ultrasound': 'diagnostics',
  'x-ray': 'diagnostics', 'pathology': 'diagnostics', 'laboratory': 'diagnostics',
  'operation': 'surgery', 'operating theatre': 'surgery', 'general surgery': 'surgery',
};

export function resolveCondition(query: string): string {
  if (!query) return '';
  const q = query.trim().toLowerCase();
  if (DISEASE_KEYWORDS[q]) return q;
  if (CARE_NEED_ALIASES[q]) return CARE_NEED_ALIASES[q];
  const tokens = q.replace(/,/g, ' ').split(/\s+/);
  for (const tok of tokens) {
    if (DISEASE_KEYWORDS[tok]) return tok;
    if (CARE_NEED_ALIASES[tok]) return CARE_NEED_ALIASES[tok];
  }
  for (const tok of tokens) {
    for (const key of Object.keys(DISEASE_KEYWORDS)) {
      if (key.includes(tok) || tok.includes(key)) return key;
    }
  }
  return q;
}

// condition key → care type — mirrors backend _resolve_care_type + CARE_TYPE_ALIASES
function resolveCareType(condition: string): string {
  if (condition === 'emergency') return 'emergency';
  if (['pregnancy'].includes(condition)) return 'maternity';
  if (['cancer', 'kidney', 'dialysis', 'diabetes', 'hypertension'].includes(condition)) return 'specialist';
  if (['heart', 'surgery'].includes(condition)) return 'specialist';
  return 'general';
}

// Care-type weights — from backend CARE_TYPE_WEIGHTS (local_need kept at neutral 50)
const CARE_TYPE_WEIGHTS: Record<string, { distance: number; condition: number; trust: number; evidence: number; localNeed: number }> = {
  emergency: { distance: 0.35, condition: 0.20, trust: 0.15, evidence: 0.20, localNeed: 0.05 },
  general:   { distance: 0.25, condition: 0.20, trust: 0.25, evidence: 0.20, localNeed: 0.05 },
  specialist:{ distance: 0.15, condition: 0.30, trust: 0.20, evidence: 0.25, localNeed: 0.05 },
  maternity: { distance: 0.25, condition: 0.25, trust: 0.20, evidence: 0.20, localNeed: 0.05 },
};

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

function computeConditionScore(facility: FacilityNode, condition: string): number {
  const keywords = DISEASE_KEYWORDS[condition];
  if (!keywords?.length) return 0;

  const text = [
    facility.specialties, facility.capability, facility.procedure,
    facility.equipment, facility.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let weightedMatch = 0;
  let totalWeight = 0;
  for (const kw of keywords) {
    const w = KEYWORD_WEIGHTS[kw] ?? 1.0;
    totalWeight += w;
    if (text.includes(kw)) weightedMatch += w;
  }
  return totalWeight > 0 ? Math.min(100, (weightedMatch / totalWeight) * 100) : 0;
}

function computeTrustScore(facility: FacilityNode): number {
  // Prefer the pre-computed PERCENT_RANK composite from the DB
  if (facility.trustScoreV2 != null) {
    return Math.min(100, Math.max(0, facility.trustScoreV2));
  }
  // Fallback approximation using numberDoctors, capacity, yearEstablished
  const doctors = Number(facility.numberDoctors) || 0;
  const capacity = Number(facility.capacity) || 0;
  const yearEst = Number(facility.yearEstablished) || new Date().getFullYear();
  const yearsOpen = Math.min(30, Math.max(0, new Date().getFullYear() - yearEst));
  const richFields = [
    facility.specialties, facility.capability, facility.procedure, facility.equipment,
  ].filter(Boolean).length;

  const infoScore  = Math.min(1, ((facility.description?.length ?? 0) / 400) * 0.6 + richFields * 0.1);
  const capScore   = Math.min(1, (doctors / 25) * 0.5 + (capacity / 200) * 0.5);
  const ageScore   = Math.min(1, yearsOpen / 20);
  return Math.round(100 * (0.40 * infoScore + 0.35 * capScore + 0.25 * ageScore));
}

function computeEvidenceScore(facility: FacilityNode): number {
  // source_credibility_score from the DB is already 0–1; scale to 0–100
  if (facility.sourceCredibilityScore != null) {
    return Math.min(100, Math.max(0, facility.sourceCredibilityScore * 100));
  }
  // Fallback: text richness across evidence fields
  const richFields = [
    facility.specialties, facility.capability, facility.procedure, facility.equipment,
  ].filter(Boolean).length;
  const descBonus = facility.description ? Math.min(30, (facility.description.length / 300) * 30) : 0;
  return Math.min(100, richFields * 15 + descBonus + (facility.sourceCount ? Math.min(20, facility.sourceCount * 4) : 0));
}

// ---------------------------------------------------------------------------
// Keyword scorer using arbitrary keyword list (for LLM-resolved conditions)
// ---------------------------------------------------------------------------

export function computeConditionScoreFromKeywords(facility: FacilityNode, keywords: string[]): number {
  if (!keywords.length) return 0;
  const text = [
    facility.specialties, facility.capability, facility.procedure,
    facility.equipment, facility.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matched = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
  return Math.round((matched / keywords.length) * 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  distance: number;
  condition: number;
  trust: number;
  evidence: number;
  careType: string;
  conditionKey: string;
}

export function calculateMatchScore(
  facility: FacilityNode,
  query: string,
  distanceKm: number,
): { score: number; breakdown: ScoreBreakdown } {
  const conditionKey = resolveCondition(query);
  const careType = resolveCareType(conditionKey);
  const w = CARE_TYPE_WEIGHTS[careType] ?? CARE_TYPE_WEIGHTS.general;

  const distScore  = computeDistanceScore(distanceKm, careType);
  const condScore  = computeConditionScore(facility, conditionKey);
  const trustScore = computeTrustScore(facility);
  const evidScore  = computeEvidenceScore(facility);
  const localNeed  = 50; // neutral; NFHS columns not fetched in the map API

  const raw =
    w.distance  * distScore +
    w.condition * condScore +
    w.trust     * trustScore +
    w.evidence  * evidScore +
    w.localNeed * localNeed;

  return {
    score: Math.round(Math.min(100, Math.max(0, raw))),
    breakdown: { distance: distScore, condition: condScore, trust: trustScore, evidence: evidScore, careType, conditionKey },
  };
}
