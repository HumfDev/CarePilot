"""Unit tests for quadratic urgency re-weighting in referral_cli.py."""
from __future__ import annotations

import unittest

from referral_cli import _apply_urgency_reweighting


def _candidate(
    facility_id: str,
    *,
    distance_km: float,
    disease_match_score: float = 60,
    baseline_trust_score: float = 70,
    evidence_strength_score: float = 60,
    local_need_score: float = 50,
) -> dict:
    return {
        "facility_id": facility_id,
        "facility_name": facility_id,
        "distance_km": distance_km,
        "disease_match_score": disease_match_score,
        "baseline_trust_score": baseline_trust_score,
        "evidence_strength_score": evidence_strength_score,
        "local_need_score": local_need_score,
        "final_recommendation_score": 70,
    }


class UrgencyReweightingTests(unittest.TestCase):
    def test_distance_weight_anchor_points(self) -> None:
        def w(u: float) -> float:
            return min(0.88, (u * u + 2 * u + 13) / 140.0)

        self.assertAlmostEqual(w(2), 0.15, places=5)
        self.assertAlmostEqual(w(3), 0.20, places=5)
        self.assertAlmostEqual(w(9), 0.80, places=5)
        self.assertAlmostEqual(w(10), 0.88, places=5)

    def test_high_urgency_promotes_closer_facility(self) -> None:
        near = _candidate("near", distance_km=3, disease_match_score=60, baseline_trust_score=70)
        far = _candidate(
            "far",
            distance_km=45,
            disease_match_score=90,
            baseline_trust_score=95,
            evidence_strength_score=90,
        )

        low = _apply_urgency_reweighting([near, far], urgency=3, care_type="specialist")
        high = _apply_urgency_reweighting([near, far], urgency=10, care_type="specialist")

        self.assertEqual(low[0]["facility_id"], "far")
        self.assertEqual(high[0]["facility_id"], "near")

    def test_ranks_are_reassigned(self) -> None:
        near = _candidate("near", distance_km=3)
        far = _candidate("far", distance_km=45, disease_match_score=90, baseline_trust_score=95)
        ranked = _apply_urgency_reweighting([near, far], urgency=10, care_type="specialist")
        self.assertEqual([c["rank"] for c in ranked], [1, 2])
        self.assertIn("urgency_adjusted_score", ranked[0])


if __name__ == "__main__":
    unittest.main()
