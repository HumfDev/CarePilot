import { test, expect } from '@playwright/test';

const MOCK_PARSE = {
  ok: true,
  care_need: 'dialysis',
  care_type: 'specialist',
  location_text: 'Jaipur',
  user_lat: 26.9124,
  user_lon: 75.7873,
  ranking_priority: 'prioritize_evidence',
  max_distance_km: 75,
  top_n: 10,
  needs_clarification: null,
  urgency_score: 5,
  urgency_label: 'Semi-urgent',
  department: 'Nephrology',
};

const MOCK_SEARCH = {
  ok: true,
  scenario_id: 'test-scenario',
  feedback_applied: false,
  candidates: [
    {
      rank: 1,
      facility_id: 'fac-near',
      facility_name: 'Near Dialysis Center',
      clean_facility_type: 'Hospital',
      clean_city: 'Jaipur',
      clean_district: 'Jaipur',
      clean_state: 'Rajasthan',
      latitude: 26.94,
      longitude: 75.7873,
      distance_km: 3,
      raw_recommendation_score: 80,
      final_recommendation_score: 82,
      feedback_adjusted_score: null,
      feedback_delta: null,
      feedback_signals: null,
      feedback_reason: null,
      score_cap_reason: null,
      uncertainty_level: 'Medium uncertainty',
      evidence_strength_score: 65,
      disease_match_score: 70,
      baseline_trust_score: 75,
      local_need_score: 50,
      score_breakdown: [],
      recommendation_reason: 'fixture',
      evidence_snippets: [],
      missing_evidence_flags: [],
      suspicious_evidence_flags: [],
      source_url_classification: null,
      facility_related_urls: [],
      care_need_evidence_urls: [],
      unrelated_source_urls: [],
    },
  ],
};

test.describe('Referral copilot E2E (mocked APIs)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/referral/parse', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PARSE),
      });
    });

    await page.route('**/api/referral/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SEARCH),
      });
    });

    await page.route('**/api/referral/summarize-search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, summary: 'Mock summary for test.' }),
      });
    });
  });

  test('parse → search shows urgency badge and ranked results', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('referral-chat-panel')).toBeVisible();
    const input = page.getByPlaceholder('Try "dialysis near Jaipur"');
    await input.fill('dialysis near Jaipur');
    await input.press('Enter');

    await expect(page.getByText(/Urgency 5\/10 · Semi-urgent/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Nephrology/)).toBeVisible();
    await expect(page.getByText(/Near Dialysis Center/)).toBeVisible({ timeout: 15_000 });
  });
});
