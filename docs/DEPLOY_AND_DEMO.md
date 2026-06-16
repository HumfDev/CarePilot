# Deploy & demo guide

Production URL: https://carepilot-2975424914277074.aws.databricksapps.com

## Pre-deploy checklist

### 1. Lakebase synced tables

Sync these Unity Catalog tables into the bound Lakebase database (`healthcare` schema):

| Synced table | UC source |
|--------------|-----------|
| `healthcare.facilities` | `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities` |
| `healthcare.facility_features_v4` | `workspace.default.facility_feature_table_v4` |

See `docs/v4-scoring-integration.md` for CLI/UI steps.

Verify:

```sql
SELECT COUNT(*) FROM healthcare.facilities;
SELECT COUNT(*), AVG(trust_score_v2) FROM healthcare.facility_features_v4;
```

Expected: ~10k facilities, avg trust score ≈ 43.5.

### 2. Bundle variables (`databricks.yml`)

| Variable | Purpose |
|----------|---------|
| `postgres_branch` / `postgres_database` | Lakebase binding |
| `genie_space_id` | Healthcare Genie space |
| `sql_warehouse_id` | Genie SQL warehouse |
| `serving_endpoint_name` | `databricks-llama-4-maverick` |

### 3. App runtime

- **Do not** set `CAREPILOT_LOCAL_DEMO` on deploy
- `CAREPILOT_ENABLE_GENIE=0` disables Genie tab only (Lakebase search still works)

### 4. Deploy

```bash
npm run deploy
```

## Architecture (production)

```
User browser
    │
    ├─ Map sidebar ──POST /api/referral/parse + /search──┐
    ├─ Referral chat ─────────────────────────────────────┤
    └─ Genie tab ───────── Genie plugin (healthcare space) │
                                                          ▼
                                              Express (AppKit server)
                                                          │
                    ┌─────────────────────────────────────┼──────────────────────┐
                    ▼                                     ▼                      ▼
           Lakebase SQL join                    referral.* tables          Model Serving
     facilities ⨝ facility_features_v4         (shortlist/notes/…)         Llama summaries
                    ▲
                    │ UC synced tables
             Unity Catalog pipelines
```

## Demo script (2 minutes)

| Step | Action | What to show |
|------|--------|--------------|
| 1 | Sidebar: `Jaipur` + `dialysis` → **Search** | Same pipeline as chat; 5–10 ranked results |
| 2 | **Hide** search form | **Ranked results · N** at top; more list space |
| 3 | Click rank #1 | Evidence card: trust, snippets, uncertainty |
| 4 | **Route** | OSRM polyline + ETA on map |
| 5 | Chat: *"dialysis near Jaipur"* | Llama search summary |
| 6 | **Genie data** tab | *"Average trust score by state"* or NFHS question |

## Local modes

| Mode | Env | Search engine |
|------|-----|---------------|
| Production parity | no `CAREPILOT_LOCAL_DEMO` | Lakebase SQL |
| Quick local | `CAREPILOT_LOCAL_DEMO=1` + `CAREPILOT_USE_PYTHON_BRIDGE=1` | Python CSV bridge |
| Local + Genie | above + `CAREPILOT_ENABLE_GENIE=1` | + Genie tab |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Empty search results | Confirm `facility_features_v4` sync completed (INNER JOIN requires scores) |
| `lakebase_search_error` | Check `LAKEBASE_ENDPOINT` and table names (`CAREPILOT_LAKEBASE_SCHEMA`) |
| Llama 502 | Verify serving endpoint permission + `DATABRICKS_SERVING_ENDPOINT_NAME` |
| Genie tab missing | Production: Genie enabled by default. Local: `CAREPILOT_ENABLE_GENIE=1` |

## Scoring note

Production uses **TypeScript scoring** over Lakebase rows (distance, disease match, trust v4, evidence heuristics, NFHS local need, safety caps). This matches the Python pipeline intent; for exact parity with offline `carepilot-referral` notebooks, set `CAREPILOT_USE_PYTHON_BRIDGE=1` (not recommended on Databricks App).
