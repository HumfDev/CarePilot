import { describe, expect, it } from 'vitest';
import {
  applyUrgencyReweighting,
  haversineKm,
  rankFacilityRows,
} from '../../server/lib/referral-scoring';
import {
  FAR_CANDIDATE,
  JAIPUR,
  MOCK_JAIPUR_FACILITY_ROWS,
  NEAR_CANDIDATE,
} from '../fixtures/referral-candidates';
import { URGENCY_WEIGHT_ANCHORS, urgencyDistanceWeight } from '../helpers/urgency-formula';

describe('urgencyDistanceWeight', () => {
  it('matches documented anchor points from the Python bridge', () => {
    for (const { urgency, expected } of URGENCY_WEIGHT_ANCHORS) {
      expect(urgencyDistanceWeight(urgency)).toBeCloseTo(expected, 5);
    }
  });

  it('clamps urgency to [1, 10]', () => {
    expect(urgencyDistanceWeight(0)).toBeCloseTo(urgencyDistanceWeight(1), 5);
    expect(urgencyDistanceWeight(99)).toBeCloseTo(urgencyDistanceWeight(10), 5);
  });
});

describe('applyUrgencyReweighting', () => {
  it('promotes closer facilities when urgency is high', () => {
    const low = applyUrgencyReweighting([NEAR_CANDIDATE, FAR_CANDIDATE], 3, 'specialist');
    const high = applyUrgencyReweighting([NEAR_CANDIDATE, FAR_CANDIDATE], 10, 'specialist');

    expect(low[0]?.facility_id).toBe(FAR_CANDIDATE.facility_id);
    expect(high[0]?.facility_id).toBe(NEAR_CANDIDATE.facility_id);
  });

  it('reassigns rank ordinals after re-sorting', () => {
    const ranked = applyUrgencyReweighting([NEAR_CANDIDATE, FAR_CANDIDATE], 10, 'specialist');
    expect(ranked.map((c) => c.rank)).toEqual([1, 2]);
  });

  it('preserves feedback delta when feedback_adjusted_score was set', () => {
    const withFeedback = {
      ...NEAR_CANDIDATE,
      final_recommendation_score: 72,
      feedback_adjusted_score: 80,
    };
    const [adjusted] = applyUrgencyReweighting([withFeedback, FAR_CANDIDATE], 10, 'specialist');
    expect(adjusted?.feedback_adjusted_score).toBeGreaterThan(adjusted?.final_recommendation_score ?? 0);
  });
});

describe('rankFacilityRows + urgency pipeline', () => {
  const searchInput = {
    care_need: 'dialysis',
    care_type: 'specialist',
    ranking_priority: 'prioritize_evidence',
    user_lat: JAIPUR.lat,
    user_lon: JAIPUR.lon,
    max_distance_km: 75,
    top_n: 10,
  };

  it('returns both Jaipur fixtures within radius', () => {
    const ranked = rankFacilityRows(MOCK_JAIPUR_FACILITY_ROWS, searchInput);
    expect(ranked.length).toBe(2);
    expect(ranked.every((c) => (c.distance_km ?? 999) <= 75)).toBe(true);
  });

  it('changes top rank after urgency re-weighting', () => {
    const base = rankFacilityRows(MOCK_JAIPUR_FACILITY_ROWS, searchInput);
    const lowUrgency = applyUrgencyReweighting(base, 3, 'specialist');
    const highUrgency = applyUrgencyReweighting(base, 10, 'specialist');

    expect(lowUrgency[0]?.facility_id).not.toBe(highUrgency[0]?.facility_id);
  });
});

describe('haversineKm', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineKm(JAIPUR.lat, JAIPUR.lon, JAIPUR.lat, JAIPUR.lon)).toBeCloseTo(0, 5);
  });
});
