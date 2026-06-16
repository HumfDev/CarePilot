/** Qualified Lakebase table names for healthcare synced UC tables. */

export const LAKEBASE_SCHEMA = process.env.CAREPILOT_LAKEBASE_SCHEMA ?? 'healthcare';

function qualify(table: string): string {
  const dbPrefix = process.env.CAREPILOT_LAKEBASE_DB_PREFIX?.trim();
  if (dbPrefix) return `${dbPrefix}.${LAKEBASE_SCHEMA}.${table}`;
  return `${LAKEBASE_SCHEMA}.${table}`;
}

export const LB = {
  facilities: qualify('facilities'),
  facilityFeaturesV4: qualify('facility_features_v4'),
  indiaPincode: qualify('india_post_pincode_directory'),
  nfhsDistrict: qualify('nfhs_5_district_health_indicators'),
  ucRegistry: qualify('uc_table_registry'),
} as const;
