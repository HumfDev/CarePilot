/**
 * Facility ranking for the map search sidebar — TypeScript port of
 * facility_scoring_pipeline.py (simplified for client-side map search).
 */
import type { FacilityNode } from '../types/facility';

const DISTANCE_BUCKETS: Record<string, Array<[number, number]>> = {
  emergency: [
    [2, 100],
    [5, 85],
    [10, 60],
    [20, 35],
    [Infinity, 10],
  ],
  general: [
    [5, 100],
    [10, 85],
    [25, 65],
    [50, 40],
    [Infinity, 15],
  ],
  specialist: [
    [10, 100],
    [25, 85],
    [50, 70],
    [100, 45],
    [Infinity, 20],
  ],
};

export const DISEASE_KEYWORDS: Record<string, string[]> = {
  diabetes: ['diabetes', 'diabetic', 'blood sugar', 'glucose', 'endocrinology', 'endocrine', 'internal medicine'],
  hypertension: ['hypertension', 'high blood pressure', 'blood pressure', 'cardiology', 'cardiac', 'heart'],
  heart: ['cardiology', 'cardiac', 'heart', 'ecg', 'echo', 'angiography', 'angioplasty', 'chest pain'],
  pregnancy: [
    'maternity',
    'pregnancy',
    'obstetrics',
    'gynecology',
    'gynaecology',
    'delivery',
    'birth',
    'labor room',
    'nicu',
  ],
  emergency: ['emergency', 'trauma', 'icu', 'ambulance', 'casualty', 'critical care', '24 hours', '24/7'],
  cancer: ['oncology', 'cancer', 'tumor', 'chemotherapy', 'radiation', 'radiotherapy'],
  kidney: ['nephrology', 'kidney', 'renal', 'dialysis', 'urology', 'hemodialysis'],
  child: ['pediatrics', 'paediatrics', 'child', 'children', 'neonatal', 'nicu'],
  surgery: ['surgery', 'surgeon', 'operation', 'operating theatre', 'ot', 'general surgery'],
  diagnostics: ['diagnostic', 'laboratory', 'lab', 'pathology', 'x-ray', 'mri', 'ct scan', 'ultrasound'],
  dialysis: ['dialysis', 'hemodialysis', 'haemodialysis', 'nephrology', 'renal'],
};

const KEYWORD_WEIGHTS: Record<string, number> = {
  cardiology: 2.0,
  cardiac: 1.8,
  dialysis: 2.4,
  nephrology: 2.4,
  emergency: 2.2,
  oncology: 2.4,
  maternity: 2.0,
  pediatrics: 2.0,
};

const CARE_NEED_ALIASES: Record<string, string> = {
  'emergency surgery': 'emergency',
  trauma: 'emergency',
  cardiology: 'heart',
  maternity: 'pregnancy',
  obstetrics: 'pregnancy',
  gynecology: 'pregnancy',
  pediatrics: 'child',
  nephrology: 'dialysis',
  renal: 'dialysis',
  oncology: 'cancer',
  endocrinology: 'diabetes',
};

const CARE_TYPE_WEIGHTS: Record<
  string,
  { distance: number; condition: number; trust: number; evidence: number; localNeed: number }
> = {
  emergency: { distance: 0.35, condition: 0.2, trust: 0.15, evidence: 0.2, localNeed: 0.05 },
  general: { distance: 0.25, condition: 0.2, trust: 0.25, evidence: 0.2, localNeed: 0.05 },
  specialist: { distance: 0.15, condition: 0.3, trust: 0.2, evidence: 0.25, localNeed: 0.05 },
  maternity: { distance: 0.25, condition: 0.25, trust: 0.2, evidence: 0.2, localNeed: 0.05 },
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

function resolveCareType(condition: string): string {
  if (condition === 'emergency') return 'emergency';
  if (condition === 'pregnancy') return 'maternity';
  if (['cancer', 'kidney', 'dialysis', 'diabetes', 'hypertension', 'heart', 'surgery'].includes(condition)) {
    return 'specialist';
  }
  return 'general';
}

export function computeDistanceScore(distanceKm: number, careType: string): number {
  const buckets = DISTANCE_BUCKETS[careType] ?? DISTANCE_BUCKETS.general;
  for (const [upper, score] of buckets) {
    if (distanceKm <= upper) return score;
  }
  return 0;
}

function facilityText(facility: FacilityNode): string {
  return [
    facility.specialties,
    facility.capability,
    facility.procedure,
    facility.equipment,
    facility.description,
    facility.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function computeConditionScore(facility: FacilityNode, condition: string): number {
  const keywords = DISEASE_KEYWORDS[condition];
  if (!keywords?.length) return 0;
  const text = facilityText(facility);
  let weightedMatch = 0;
  let totalWeight = 0;
  for (const kw of keywords) {
    const w = KEYWORD_WEIGHTS[kw] ?? 1.0;
    totalWeight += w;
    if (text.includes(kw)) weightedMatch += w;
  }
  return totalWeight > 0 ? Math.min(100, (weightedMatch / totalWeight) * 100) : 0;
}

export function computeConditionScoreFromKeywords(facility: FacilityNode, keywords: string[]): number {
  if (!keywords.length) return 0;
  const text = facilityText(facility);
  const matched = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
  return Math.round((matched / keywords.length) * 100);
}

function computeTrustScore(facility: FacilityNode): number {
  const v2 = facility.trustScoreV2 ?? facility.trustScore;
  if (v2 != null) return Math.min(100, Math.max(0, v2));
  return 50;
}

function computeEvidenceScore(facility: FacilityNode): number {
  if (facility.sourceCredibilityScore != null) {
    return Math.min(100, Math.max(0, facility.sourceCredibilityScore * 100));
  }
  const richFields = [facility.specialties, facility.capability, facility.procedure, facility.equipment].filter(
    Boolean,
  ).length;
  const descBonus = facility.description ? Math.min(30, (facility.description.length / 300) * 30) : 0;
  return Math.min(100, richFields * 15 + descBonus + (facility.sourceCount ? Math.min(20, facility.sourceCount * 4) : 0));
}

export function calculateMatchScore(
  facility: FacilityNode,
  query: string,
  distanceKm: number,
): { score: number } {
  const conditionKey = resolveCondition(query);
  const careType = resolveCareType(conditionKey);
  const w = CARE_TYPE_WEIGHTS[careType] ?? CARE_TYPE_WEIGHTS.general;

  const distScore = computeDistanceScore(distanceKm, careType);
  const condScore = computeConditionScore(facility, conditionKey);
  const trustScore = computeTrustScore(facility);
  const evidScore = computeEvidenceScore(facility);
  const localNeed = 50;

  const raw =
    w.distance * distScore +
    w.condition * condScore +
    w.trust * trustScore +
    w.evidence * evidScore +
    w.localNeed * localNeed;

  return { score: Math.round(Math.min(100, Math.max(0, raw))) };
}

/** Rule-based fallback when LLM resolve-condition is unavailable. */
export function resolveConditionRuleBased(query: string): {
  keywords: string[];
  careType: string;
  label: string;
} {
  const key = resolveCondition(query);
  const careType = resolveCareType(key);
  const keywords = DISEASE_KEYWORDS[key] ?? query.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    keywords,
    careType,
    label: key ? key.replace(/_/g, ' ') : query.trim() || 'General care',
  };
}
