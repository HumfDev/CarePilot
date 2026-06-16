import { describe, expect, it } from 'vitest';
import { parseReferralMessage } from '../../server/lib/referral-parse';
import { JAIPUR } from '../fixtures/referral-candidates';

describe('parseReferralMessage', () => {
  it('extracts dialysis + Jaipur from a natural-language query', () => {
    const result = parseReferralMessage('dialysis near Jaipur');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.care_need).toBe('dialysis');
    expect(result.care_type).toBe('specialist');
    expect(result.location_text).toBe('Jaipur');
    expect(result.user_lat).toBeCloseTo(JAIPUR.lat, 4);
    expect(result.user_lon).toBeCloseTo(JAIPUR.lon, 4);
    expect(result.ranking_priority).toBe('prioritize_evidence');
    expect(result.max_distance_km).toBe(75);
    expect(result.top_n).toBe(10);
  });

  it('detects emergency care type and custom radius', () => {
    const result = parseReferralMessage('emergency trauma within 30 km near Patna');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.care_need).toBe('emergency');
    expect(result.care_type).toBe('emergency');
    expect(result.location_text).toBe('Patna');
    expect(result.max_distance_km).toBe(30);
  });

  it('asks for clarification when care need and location are both missing', () => {
    const result = parseReferralMessage('hello there');
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe('needs_clarification');
    expect(result.needs_clarification).toBe('both');
  });

  it('rejects empty messages', () => {
    const result = parseReferralMessage('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('empty_message');
  });
});
