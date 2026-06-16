/**
 * Canonical quadratic urgency distance-weight formula shared by:
 * - server/lib/referral-scoring.ts (applyUrgencyReweighting)
 * - python_bridge/referral_cli.py (_apply_urgency_reweighting)
 */
export function urgencyDistanceWeight(urgency: number): number {
  const u = Math.max(1, Math.min(10, urgency));
  return Math.min(0.88, (u * u + 2 * u + 13) / 140);
}

/** Anchor points documented in referral_cli.py (fitted curve). */
export const URGENCY_WEIGHT_ANCHORS: Array<{ urgency: number; expected: number }> = [
  { urgency: 2, expected: 0.15 },
  { urgency: 3, expected: 0.2 },
  { urgency: 9, expected: 0.8 },
  { urgency: 10, expected: 0.88 },
];
