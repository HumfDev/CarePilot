# Referral UI integration plan

This document explains how the **CarePilot Referral Copilot** Python backend
(`/Users/joon/carepilot-referral`) plugs into the **HumfDev/CarePilot** React +
Express + AppKit app shell (this repo). It is the source of truth for the
contract between the two halves.

> **Not a medical advice app.** This is a planner-facing referral copilot. All
> UI strings and LLM prompts must use cautious wording — _candidate for
> review_, _evidence suggests_, _needs verification_, _verify before
> referral_. Never imply a diagnosis or a definitive recommendation.

## Architecture

```
                 ┌──────────────────────────────────────────────────────────┐
                 │ Browser (React, Vite, Tailwind, react-leaflet)           │
                 │                                                          │
                 │  ChatPage ──► useReferralSearch                          │
                 │      │            │                                      │
                 │      │            ├─ POST /api/referral/parse            │
                 │      │            ├─ POST /api/referral/search           │
                 │      │            ├─ POST /api/referral/{shortlist|note  │
                 │      │            │       |review|override}              │
                 │      │            └─ GET  /api/referral/workspace/:id    │
                 │      │                                                   │
                 │      ├─► IndiaMapPanel        (ranked, numbered markers) │
                 │      ├─► ReferralCandidateList (compact rows)            │
                 │      ├─► ReferralCandidateCard (modal: evidence + acts)  │
                 │      └─► ReferralChatPanel   (NL input + assistant msg)  │
                 └──────────────────────────────────────────────────────────┘
                                            │ JSON over HTTP
                                            ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │ Express (AppKit server plugin)                           │
                 │                                                          │
                 │  /api/referral/*   →   pythonBridge(op, payload)         │
                 │  /api/map/*        →   Lakebase (raw + v4 LEFT JOIN)     │
                 │  /api/chat/*       →   AI Gateway (existing, untouched)  │
                 └──────────────────────────────────────────────────────────┘
                                            │ spawn + stdin/stdout JSON
                                            ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │ python_bridge/referral_cli.py                            │
                 │                                                          │
                 │  argv: --op {parse|search|shortlist|note|review|         │
                 │              override|workspace}                         │
                 │  stdin:  request JSON                                    │
                 │  stdout: response JSON                                   │
                 │                                                          │
                 │  ┌────────────────────────────────────────────────────┐  │
                 │  │ imports: facility_scoring_pipeline, persistence    │  │
                 │  │   (from $CAREPILOT_BACKEND_DIR)                    │  │
                 │  │ data:    $CAREPILOT_BACKEND_CSV                    │  │
                 │  │ cache:   .cache/clean_facilities.pickle            │  │
                 │  └────────────────────────────────────────────────────┘  │
                 └──────────────────────────────────────────────────────────┘
```

## End-to-end flow

```
User types in chat        "dialysis near Jaipur"
       │
       ▼
ReferralChatPanel
   ├─ POST /api/referral/parse  →  { care_need:"dialysis", user_lat:26.91, ... }
   └─ POST /api/referral/search →  { scenario_id, candidates:[…] }
       │
       ▼
useReferralSearch
   ├─ setSearchParams(...)
   ├─ setCandidates(...)        ranked 1..N from the scoring pipeline
   └─ setScenarioId(...)
       │
       ▼
React state propagates
   ├─ IndiaMapPanel        renders numbered markers coloured by uncertainty
   ├─ ReferralCandidateList renders compact rows
   └─ ReferralChatPanel    appends an assistant message summarising the result
       │
       ▼
User clicks marker or list row → setSelectedCandidateId
   └─ ReferralCandidateCard opens (modal) with evidence + URL classification
                                  + missing/suspicious flags + verification step
       │
       ▼
User acts                save shortlist | add note | review | override
   └─ POST /api/referral/{shortlist|note|review|override}
       │  (writes through persistence.py SQLite)
       ▼
useReferralSearch re-runs /api/referral/search with the same params
   └─ feedback-aware re-ranking pulls `feedback_adjusted_score`,
      `feedback_signals`, `feedback_reason` onto each candidate
```

## Source of truth

| Concern                        | Owner                           | Notes                                             |
| ------------------------------ | ------------------------------- | ------------------------------------------------- |
| Cleaning, scoring, evidence    | `facility_scoring_pipeline.py`  | **Never** ported to TypeScript                    |
| Trust / evidence / uncertainty | Same                            | UI renders, never recomputes                      |
| Persistence                    | `persistence.py` (SQLite)       | `~/.carepilot/state.db` by default                |
| Feedback re-ranking            | `apply_feedback_reranking(...)` | Layered on top of base scores                     |
| Card-level LLM summary         | `llm_summary.py` (optional)     | Cached by scenario × payload hash                 |
| Intent extraction              | `referral_cli.py op=parse`      | Regex + deterministic city table; LLM is optional |

## Backend environment

| Env var                       | Default                                          | Purpose                                                      |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `CAREPILOT_BACKEND_DIR`       | `/Users/joon/carepilot-referral`                 | Where `facility_scoring_pipeline.py` + `persistence.py` live |
| `CAREPILOT_BACKEND_CSV`       | `$CAREPILOT_BACKEND_DIR/clean_facilities_v4.csv` | Source dataset                                               |
| `CAREPILOT_DB_PATH`           | `~/.carepilot/state.db`                          | SQLite persistence DB                                        |
| `CAREPILOT_PYTHON`            | `python3`                                        | Python interpreter the Node bridge spawns                    |
| `CAREPILOT_BRIDGE_TIMEOUT_MS` | `25000`                                          | Per-call subprocess timeout                                  |

## API contract (summary — full schema below)

| Method | Path                                  | Purpose                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/referral/parse`                 | NL → `{ care_need, care_type, user_lat, user_lon, ... }`             |
| POST   | `/api/referral/search`                | Params → `{ scenario_id, candidates: [...] }`                        |
| POST   | `/api/referral/shortlist`             | Save candidate to shortlist                                          |
| POST   | `/api/referral/note`                  | Save free-text note                                                  |
| POST   | `/api/referral/review`                | Set review decision (`accepted` / `needs_verification` / `rejected`) |
| POST   | `/api/referral/override`              | Manual score override with a reason                                  |
| GET    | `/api/referral/workspace/:scenarioId` | Read back all planner state for a scenario                           |

### `POST /api/referral/parse`

Request:

```json
{ "message": "dialysis near Jaipur" }
```

Response:

```json
{
  "ok": true,
  "care_need": "dialysis",
  "care_type": "specialist",
  "location_text": "Jaipur",
  "user_lat": 26.9124,
  "user_lon": 75.7873,
  "ranking_priority": "prioritize_evidence",
  "max_distance_km": 75,
  "top_n": 10,
  "needs_clarification": null
}
```

On parse failure, the response sets `ok: false` and `needs_clarification` to one
of `"location"`, `"care_need"`, or `"both"`. The UI must show the message
unchanged and ask the planner for clarification — it must not run a search.

### `POST /api/referral/search`

Request: any of the fields returned by `parse`, plus `use_feedback_reranking`
(default `true`).

Response:

```json
{
  "scenario_id": "…",
  "candidates": [
    {
      "rank": 1,
      "facility_id": "…",
      "facility_name": "…",
      "clean_facility_type": "hospital",
      "clean_city": "…",
      "clean_district": "…",
      "clean_state": "…",
      "latitude": 26.9, "longitude": 75.8,
      "distance_km": 3.3,
      "raw_recommendation_score": 94.1,
      "final_recommendation_score": 91.2,
      "feedback_adjusted_score": 96.2,
      "feedback_delta": 5.0,
      "feedback_signals": ["previously_shortlisted", "reviewed"],
      "feedback_reason": "…",
      "score_cap_reason": "…",
      "uncertainty_level": "Medium uncertainty",
      "evidence_strength_score": 86,
      "disease_match_score": 100,
      "baseline_trust_score": 91,
      "local_need_score": 50,
      "score_breakdown": [...],
      "recommendation_reason": "…",
      "evidence_snippets": [...],
      "missing_evidence_flags": [...],
      "suspicious_evidence_flags": [...],
      "source_url_classification": {...},
      "facility_related_urls": [...],
      "care_need_evidence_urls": [...],
      "unrelated_source_urls": [...]
    }
  ]
}
```

The frontend renders this contract **as-is**. It does not recompute scores,
re-derive evidence, or invent fields the pipeline did not produce.

## Layout phases

**Phase 1 (this PR):** `Map | Chat`. The compact ranked list sits inside the
left (map) panel, beneath the map. Marker click opens a modal candidate card.

**Phase 2 (later):** `List | Map | Chat`. The compact list graduates to its own
column. The map keeps numbered markers; the card stays as a modal or moves to a
drawer over the map.

## What this integration explicitly does NOT do

- It does not rebuild the scoring engine in TypeScript.
- It does not let Genie return raw facilities as if they were ranked
  recommendations.
- It does not strip the Dijkstra routing — that stays available when no search
  is active.
- It does not change the deployment story; the Python bridge is invoked via
  `child_process.spawn`, so the Databricks App image just needs `python3` + the
  contents of `/Users/joon/carepilot-referral/` on disk (or mounted via a
  workspace file) plus our `requirements.txt`.
