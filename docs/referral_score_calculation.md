# Referral Copilot — How Scores Are Calculated

This document explains how **CarePilot Referral Copilot** scores and ranks facility candidates.

> **Important:** The recommendation score shown in the ranked list is **not** the same as `trust_score_v2` (map marker colour).  
> Rankings use a per-request **evidence-aware recommendation score** recomputed for every search.  
> Implementation (production): `server/lib/lakebase-referral-search.ts` + `server/lib/referral-scoring.ts` over Lakebase synced `facility_features_v4`.  
> Local fallback: `carepilot-referral/facility_scoring_pipeline.py` via `python_bridge/referral_cli.py` when `CAREPILOT_USE_PYTHON_BRIDGE=1`.

**Not medical advice.** Scores are a planner-facing sorting aid. Always verify by phone call or the official website before referral.

---

## 1. At a glance

```
User request (care_need, location, care_type, …)
        │
        ▼
Distance filter (max_distance_km)
        │
        ▼
Six signals computed
  · distance_score
  · disease_match_score
  · baseline_trust_score
  · evidence_strength_score
  · local_need_score
  · uncertainty_penalty
        │
        ▼
raw_recommendation_score  (weighted sum − uncertainty penalty)
        │
        ▼
apply_evidence_safety_caps  (soft cap)
        │
        ▼
final_recommendation_score  (0–100)
        │
        ▼  (optional, feedback ON)
apply_feedback_reranking
        │
        ▼
feedback_adjusted_score  (used for UI sort order)
```

| Field | Meaning |
|-------|---------|
| `raw_recommendation_score` | Weighted sum before safety caps |
| `final_recommendation_score` | **Base recommendation score** after evidence safety caps (never overwritten by feedback) |
| `feedback_adjusted_score` | Score after planner feedback (shortlist, review, reject, manual override) |
| `baseline_trust_score` | Upstream trust signal from `trust_score_v2` (v4 pipeline) |

---

## 2. Inputs (per search)

Main arguments to `recommend_facilities()`:

| Argument | Example | Role |
|----------|---------|------|
| `user_lat`, `user_lon` | Coordinates near Jaipur | Origin for distance |
| `condition` / `care_need` | `dialysis` | Disease/care keyword matching (normalised via `resolve_condition_key`) |
| `care_type` | `specialist`, `emergency`, … | Weight profile selection |
| `max_distance_km` | `75` | Drop facilities outside radius |
| `ranking_priority` | `prioritize_evidence` | Re-weight distance / evidence / trust |
| `top_n` | `10` | Number of top candidates returned |

Data source: `clean_facilities_v4.csv` (or an equivalent cleaned DataFrame).

---

## 3. Component scores (each 0–100)

### 3.1 Distance — `distance_score`

Great-circle Haversine `distance_km` is mapped to a bucket table by care type.

| Care-type bucket | Example bands (km → score) |
|------------------|--------------------------|
| **emergency** | ≤2→100, ≤5→85, ≤10→60, ≤20→35, else→10 |
| **general** | ≤5→100, ≤10→85, ≤25→65, ≤50→40, else→15 |
| **specialist** / **chronic** | ≤10→100, ≤25→85, ≤50→70, ≤100→45, else→20 |

`care_type` `specialist` or `chronic` uses the specialist bucket; `emergency` uses the emergency bucket.

### 3.2 Disease match — `disease_match_score`

Keywords for the care need are searched in facility text (`medical_text` = name + description + specialties + …).

1. `create_disease_match_scores()` builds `match_<disease>` columns (0–100).
2. Where **tiers** exist, keywords are weighted differently:
   - **strong** (e.g. `dialysis`, `hemodialysis`) — 100%
   - **medium** (e.g. `nephrology`) — 60%
   - **weak** (e.g. `renal`, `urology`) — 25%; weak-only matches are capped lower
3. Per-row raw sums are normalised by the dataset 95th percentile to a 0–100 scale.

Example strong keywords for `dialysis`: `dialysis`, `hemodialysis`, `dialysis unit`, `renalcare & dialysis`, etc.

### 3.3 Baseline trust — `baseline_trust_score`

Uses upstream **`trust_score_v2`** from the v4 feature table as-is. If missing, falls back to the mean of v4 sub-scores or default 50.

- Same source as map marker colour (Trust score v4 legend).
- A **separate signal** from the final recommendation score; only contributes via its weight.

### 3.4 Evidence strength — `evidence_strength_score`

Per facility row:

1. `extract_evidence_snippets()` — condition-aware snippets (field, matched_terms, confidence, tier)
2. `detect_missing_evidence()` / `detect_suspicious_evidence()` — missing / suspicious flags
3. Three-way `source_url` classification → `unrelated_url_ratio`

**Additions (approximate):**

- Field-weighted sum (specialties 1.0, equipment 0.9, procedure 0.8, capability 0.6, description 0.4)
- Confidence multipliers: high 1.0 / medium 0.7 / low 0.45
- Duplicate hits in the same field: 50% diminishing returns
- +15 if source URLs present; +5 if specialties or equipment hit
- Base capped around the low 80s before penalties

**Deductions:**

- Missing flags: up to 4 pts each, 20 cap total
- Suspicious flags: up to 6 pts each, 25 cap total
- Unrelated URL ratio > 50%: linear deduction (max 25)

### 3.5 Local need — `local_need_score`

Maps NFHS-style regional columns per condition (`LOCAL_NEED_MAP`).  
If columns are missing or the condition has no mapping, returns **neutral 50**.

Example: `pregnancy` → `institutional_birth_5y_pct` (lower value → lower access → higher need).

### 3.6 Uncertainty — `uncertainty_level` / `uncertainty_penalty`

Bucketed from `evidence_strength_score` and missing/suspicious flags:

| Level | Summary condition | Penalty |
|-------|-------------------|---------|
| Low uncertainty | evidence ≥ 65, no severe missing, no suspicious | 5 |
| Medium uncertainty | evidence ≥ 35, suspicious ≤ 1 | 35 |
| High uncertainty | otherwise | 70 |

If unrelated URL ratio > 50% and there is no strong direct evidence, Low is bumped one step to Medium.

---

## 4. Weights (care_type × ranking_priority)

### 4.1 Base weights by care_type (positive terms sum to 1.0)

| care_type | distance | condition | trust | evidence | local_need | uncertainty* |
|-----------|----------|-----------|-------|----------|------------|--------------|
| emergency | 0.35 | 0.20 | 0.15 | 0.20 | 0.05 | 0.05 |
| general | 0.25 | 0.20 | 0.25 | 0.20 | 0.05 | 0.05 |
| specialist / chronic | 0.15 | 0.30 | 0.20 | 0.25 | 0.05 | 0.05 |
| maternity | 0.25 | 0.25 | 0.20 | 0.20 | 0.05 | 0.05 |

\* `uncertainty` is a penalty multiplier and is **not** included in the 1.0 positive sum.

### 4.2 ranking_priority multipliers

| Priority | Effect |
|----------|--------|
| `balanced` | all ×1.0 |
| `prioritize_distance` | distance ×2.5 |
| `prioritize_evidence` | condition ×1.5, evidence ×2.5 |
| `prioritize_trust` | trust ×2.5 |

After multipliers, distance + condition + trust + evidence + local_need are re-normalised to sum to 1.0.

---

## 5. raw → final formula

### 5.1 Raw score

```
raw = w_distance    × distance_score
    + w_condition   × disease_match_score
    + w_trust       × baseline_trust_score
    + w_evidence    × evidence_strength_score
    + w_local_need  × local_need_score
    − w_uncertainty × uncertainty_penalty
```

`score_breakdown` JSON stores per-component `score`, `weight`, and `contribution`.

### 5.2 Evidence safety caps (soft cap)

Even a high `raw` is pulled down with **soft caps**, not hard clips (`_soft_cap`: only 15% of excess above the cap is kept → rank order preserved).

| Condition | Approx. cap |
|-----------|-------------|
| High uncertainty | ~70 |
| evidence_strength < 35 | ~65 |
| No evidence snippets | ~55 |
| Evidence only in description | ~60 |
| Severe suspicious flags | ~70 |
| Unrelated URL > 80% | ~78 |
| Unrelated URL > 95% (no strong direct evidence) | ~70 |

```
final_recommendation_score = clip(capped_score, 0, 100)
score_cap_reason = semicolon-joined cap reasons (empty if none applied)
```

---

## 6. Feedback re-ranking (`feedback_adjusted_score`)

`final_recommendation_score` is **never overwritten**.  
Only planner actions stored for the same search scenario (`scenario_id` = SHA256 of normalised search params) are applied.

| Planner action | Default Δ |
|----------------|-----------|
| Saved to shortlist | +8 |
| Review `reviewed` | +5 |
| `needs_verification` | +2 |
| Has notes | +1 |
| `rejected` | −30 |
| Manual override | **Sets** score to `override_score` |

Result is clipped to 0–100 and sorted by `feedback_adjusted_score`.  
Full flow: `carepilot-referral/docs/feedback_reranking_flow.md`.

---

## 7. What the UI shows

| UI location | Score displayed |
|-------------|-----------------|
| Ranked list / candidate card | `feedback_adjusted_score` ?? `final_recommendation_score` |
| Card breakdown | `score_breakdown` (six components) |
| Map markers (v4 legend) | `trust_score_v2` / baseline (separate from recommendation score) |
| Route ETA | Unrelated to referral score. Default: **OSRM** road-network ETA (`ROUTE_ENGINE=osrm_with_fallback`); falls back to haversine mock. Not live traffic. |

---

## 8. Related files

| File | Role |
|------|------|
| `carepilot-referral/facility_scoring_pipeline.py` | Full scoring engine |
| `carepilot-referral/persistence.py` | Scenario + feedback SQLite |
| `CarePilot/python_bridge/referral_cli.py` | CLI / API bridge |
| `CarePilot/server/routes/referral-routes.ts` | HTTP API |
| `CarePilot/docs/v4-scoring-integration.md` | v4 trust_score map integration |
| `carepilot-referral/docs/feedback_reranking_flow.md` | Feedback re-ranking detail |

---

## 9. Worked example (dialysis near Jaipur, conceptual)

1. Vaishali Hospital: high `disease_match` (dialysis/nephrology text), solid `evidence_strength`, ~5 km → distance, condition, and evidence all contribute.
2. `baseline_trust` in the 70s adds via the trust term.
3. Many unrelated URLs → strength penalty + cap near ~78.
4. raw 85 → capped to ~78 → `final_recommendation_score` ≈ 78.x.
5. If previously shortlisted + reviewed → `feedback_adjusted` +13 (clipped at 100).

Exact numbers vary by facility and text. For precise values, use `score_breakdown` and `recommendation_reason` in the API response.
