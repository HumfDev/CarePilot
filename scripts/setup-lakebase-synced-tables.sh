#!/usr/bin/env bash
# Sync dh_EDA.ipynb healthcare Unity Catalog tables into Lakebase Postgres.
# Requires CREATE CATALOG on the workspace metastore (workspace admin).
set -euo pipefail

PROFILE="${DATABRICKS_CONFIG_PROFILE:-dbc-72018123-58b0}"
PROJECT="carepilot-db"
BRANCH="projects/${PROJECT}/branches/production"
LAKEBASE_CATALOG="carepilot_lakebase"
SCHEMA="healthcare"
STORAGE_CATALOG="workspace"
STORAGE_SCHEMA="default"

echo "==> Register Lakebase database as UC catalog: ${LAKEBASE_CATALOG}"
databricks postgres create-catalog "${LAKEBASE_CATALOG}" \
  --profile "${PROFILE}" \
  --json "{
    \"spec\": {
      \"postgres_database\": \"databricks_postgres\",
      \"branch\": \"${BRANCH}\"
    }
  }"

create_synced_table() {
  local table="$1"
  local source="$2"
  local pk_json="$3"

  echo "==> Syncing ${source} -> ${LAKEBASE_CATALOG}.${SCHEMA}.${table}"
  databricks postgres create-synced-table "${LAKEBASE_CATALOG}.${SCHEMA}.${table}" \
    --profile "${PROFILE}" \
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
    }"
}

create_synced_table "facilities" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities" \
  '["unique_id"]'

create_synced_table "india_post_pincode_directory" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory" \
  '["pincode", "officename", "district"]'

create_synced_table "nfhs_5_district_health_indicators" \
  "databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators" \
  '["district_name", "state_ut"]'

echo "==> Done. After sync completes, add these tables to the Genie space:"
echo "    ${LAKEBASE_CATALOG}.${SCHEMA}.facilities"
echo "    ${LAKEBASE_CATALOG}.${SCHEMA}.india_post_pincode_directory"
echo "    ${LAKEBASE_CATALOG}.${SCHEMA}.nfhs_5_district_health_indicators"
