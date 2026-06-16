interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
}

const UC_HEALTHCARE_TABLES = [
  {
    table_name: 'facility_feature_table_v4',
    unity_catalog_table: 'workspace.default.facility_feature_table_v4',
    description: 'Feature-engineered facility table with resolved geocoordinates and enriched attributes',
  },
  {
    table_name: 'facilities',
    unity_catalog_table:
      'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities',
    description: 'Healthcare facilities (names, locations, specialties, capacity)',
  },
  {
    table_name: 'india_post_pincode_directory',
    unity_catalog_table:
      'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory',
    description: 'India Post PIN code directory with district and state mappings',
  },
  {
    table_name: 'nfhs_5_district_health_indicators',
    unity_catalog_table:
      'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators',
    description: 'NFHS-5 district-level health and demographic indicators',
  },
] as const;

export async function setupHealthcareLakebase(appkit: AppKitWithLakebase) {
  await appkit.lakebase.query('CREATE SCHEMA IF NOT EXISTS healthcare');

  await appkit.lakebase.query(`
    CREATE TABLE IF NOT EXISTS healthcare.uc_table_registry (
      table_name TEXT PRIMARY KEY,
      unity_catalog_table TEXT NOT NULL,
      description TEXT,
      notebook_source TEXT DEFAULT 'dh_EDA.ipynb.ipynb',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  for (const row of UC_HEALTHCARE_TABLES) {
    await appkit.lakebase.query(
      `INSERT INTO healthcare.uc_table_registry (table_name, unity_catalog_table, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (table_name) DO UPDATE
       SET unity_catalog_table = EXCLUDED.unity_catalog_table,
           description = EXCLUDED.description,
           updated_at = NOW()`,
      [row.table_name, row.unity_catalog_table, row.description],
    );
  }
}
