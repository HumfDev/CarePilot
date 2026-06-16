# v4 trust score integration

The map markers in `IndiaMapPanel` can be coloured by `trust_score_v2` (computed
by the `workspace.default.facility_feature_table_v4` pipeline in the sister
Python project). This requires the scored table to be mirrored into the same
Lakebase Postgres branch the app is bound to.

## 1. Source of truth (Unity Catalog)

|                |                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table          | `workspace.default.facility_feature_table_v4`                                                                                                                                                                                            |
| Shape          | 10,026 rows × 90 columns                                                                                                                                                                                                                 |
| Built by       | `/Workspace/Users/wh4570@uw.edu/DBs_HacksAIsummit/facility_feature_pipeline_v4` (SQL notebook)                                                                                                                                           |
| Key columns    | `facility_id` (UUID), `trust_score_v2` (0..100), `info_richness_score`, `source_credibility_score`, `clinical_capacity_score`, `extra_signals_score`, `geo_quality_score`, `coord_source`, `source_count`, `is_hospital`, `nfhs_matched` |
| v4-only extras | `recency_of_page_update`, `engagement_metrics_n_followers`, `engagement_metrics_n_likes`, `yearEstablished`, `facebookLink`                                                                                                              |

## 2. Create the Lakebase synced table

The app uses Lakebase Postgres (not UC) for serving, so the table has to be
synced into the bound Lakebase branch. Choose either path:

### Option A — Databricks UI (one-time)

1. Catalog Explorer → pick `workspace.default.facility_feature_table_v4`.
2. **Create → Synced table**.
3. Target database: the same Lakebase database `app.yaml` references (e.g.
   `carepilot_lakebase` → schema `healthcare`).
4. Synced table name: **`facility_features_v4`** (the route below assumes this
   exact name).
5. Primary key: `facility_id`.
6. Sync mode: `Triggered` (or `Continuous` if you re-run the pipeline often).

### Option B — Databricks CLI

```bash
databricks api post /api/2.0/database/synced_tables --json '{
  "synced_table": {
    "name": "carepilot_lakebase.healthcare.facility_features_v4",
    "spec": {
      "source_table_full_name": "workspace.default.facility_feature_table_v4",
      "primary_key_columns": ["facility_id"],
      "scheduling_policy": "TRIGGERED"
    }
  }
}'
```

After the sync completes (~30s for 10k rows), verify:

```bash
databricks api post /api/2.0/sql/statements --json '{
  "warehouse_id": "b2bb07abff382b79",
  "statement": "SELECT COUNT(*), AVG(trust_score_v2) FROM carepilot_lakebase.healthcare.facility_features_v4"
}'
```

Expected: ~10,026 rows, avg trust score ≈ 43.5.

## 3. App behaviour with / without the synced table

`server/routes/map-routes.ts` uses a **LEFT JOIN**, so:

| `facility_features_v4` present? | Result                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| Yes                             | Markers coloured by `trust_score_v2`, tooltip shows numeric score |
| No                              | Same grey markers as before — no error, no crash                  |

This means you can ship the UI patch first and turn on the sync separately.

## 4. Score buckets used by the UI

`IndiaMapPanel` colours markers using these quintile-ish buckets (matches the
v4 score distribution: mean 43.5, p10 25.8, p50 41.9, p90 63.0):

| Bucket  | Score range             | Marker colour     |
| ------- | ----------------------- | ----------------- |
| Top     | ≥ 70                    | green `#22C55E`   |
| High    | 55 – 70                 | lime `#A3E635`    |
| Mid     | 40 – 55                 | amber `#F59E0B`   |
| Low     | 25 – 40                 | orange `#FB923C`  |
| Bottom  | < 25                    | red `#EF4444`     |
| Unknown | NULL (sync not present) | neutral `#525252` |

Radius scales linearly from 3 px (score 0) to 7 px (score 100).
