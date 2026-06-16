#!/usr/bin/env bash
# Sync healthcare Unity Catalog tables into Lakebase Postgres.
set -euo pipefail

PROJECT="skyler-carepilot"
BRANCH="projects/${PROJECT}/branches/production"
LAKEBASE_CATALOG="skyler_carepilot_lakebase"
SCHEMA="healthcare"
STORAGE_CATALOG="workspace"
STORAGE_SCHEMA="default"

echo "==> Register Lakebase database as UC catalog: ${LAKEBASE_CATALOG}"
databricks postgres create-catalog "${LAKEBASE_CATALOG}" \
  --json "{
    \"spec\": {
      \"postgres_database\": \"databricks_postgres\",
      \"branch\": \"${BRANCH}\"
    }
  }" || echo "(catalog may already exist, continuing)"

create_synced_table() {
  local table="$1"
  local source="$2"
  local pk_json="$3"

  echo "==> Syncing ${source} -> ${LAKEBASE_CATALOG}.${SCHEMA}.${table}"
  databricks postgres create-synced-table "${LAKEBASE_CATALOG}.${SCHEMA}.${table}" \
    --json "{
      \"spec\": {
        \"source_table_full_name\": \"${source}\",
        \"primary_key_columns\": ${pk_json},
        \"scheduling_policy\": \"SNAPSHOT\",
        \"branch\": \"${BRANCH}\",
        \"postgres_database\": \"databricks_postgres\",
        \"create_database_objects_if_missing\": true,
        \"new_pipeline_spec\": {
          \"storage_catalog\": \"${STORAGE_CATALOG}\",
          \"storage_schema\": \"${STORAGE_SCHEMA}\"
        }
      }
    }" || echo "(table sync may already exist, continuing)"
}

create_synced_table "facility_feature_table_v4" \
  "workspace.default.facility_feature_table_v4" \
  '["facility_id"]'

create_synced_table "facilities" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities" \
  '["unique_id"]'

create_synced_table "india_post_pincode_directory" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory" \
  '["pincode", "officename", "district"]'

create_synced_table "nfhs_5_district_health_indicators" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators" \
  '["district_name", "state_ut"]'

echo "==> Done. Sync pipelines created — data will appear in Lakebase within a few minutes."
