import type { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: { extend(fn: (app: Application) => void): void };
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function setupMapRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.get('/api/map/facilities', async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 10000);
      const minScoreParam = Number(req.query.minScore);
      const minScore = Number.isFinite(minScoreParam) ? minScoreParam : null;

      // LEFT JOIN with the v4 scored table (synced from
      // workspace.default.facility_feature_table_v4 — see
      // docs/v4-scoring-integration.md). If the sync isn't in place yet, every
      // s.* column comes back NULL and the map falls back to neutral markers.
      const baseSql = `
        SELECT f.unique_id,
               f.name,
               f.latitude,
               f.longitude,
               f.address_city,
               f."address_stateOrRegion",
               s.trust_score_v2,
               s.info_richness_score,
               s.source_credibility_score,
               s.clinical_capacity_score,
               s.extra_signals_score,
               s.geo_quality_score,
               s.source_count,
               s.is_hospital,
               s.nfhs_matched,
               s.coord_source
        FROM carepilot_lakebase.healthcare.facilities f
        LEFT JOIN carepilot_lakebase.healthcare.facility_features_v4 s
          ON f.unique_id = s.facility_id
        WHERE f.latitude IS NOT NULL
          AND f.longitude IS NOT NULL
          AND f.latitude BETWEEN 6 AND 37
          AND f.longitude BETWEEN 68 AND 97
      `;

      const params: unknown[] = [];
      let sql = baseSql;
      if (minScore !== null) {
        params.push(minScore);
        sql += ` AND s.trust_score_v2 >= $${params.length}`;
      }
      params.push(limit);
      sql += `\n        ORDER BY s.trust_score_v2 DESC NULLS LAST\n        LIMIT $${params.length}`;

      try {
        const result = await appkit.lakebase.query(sql, params);

        const facilities = result.rows.map((row) => ({
          id: asString(row.unique_id, 'unknown'),
          name: asString(row.name, 'Unknown facility'),
          lat: Number(row.latitude),
          lng: Number(row.longitude),
          city: row.address_city != null ? asString(row.address_city) : null,
          state: row.address_stateOrRegion != null ? asString(row.address_stateOrRegion) : null,
          trustScore: toOptionalNumber(row.trust_score_v2),
          components:
            row.trust_score_v2 != null
              ? {
                  infoRichness: toOptionalNumber(row.info_richness_score),
                  sourceCredibility: toOptionalNumber(row.source_credibility_score),
                  clinicalCapacity: toOptionalNumber(row.clinical_capacity_score),
                  extraSignals: toOptionalNumber(row.extra_signals_score),
                  geoQuality: toOptionalNumber(row.geo_quality_score),
                }
              : null,
          sourceCount: toOptionalNumber(row.source_count),
          isHospital: row.is_hospital == null ? null : Number(row.is_hospital) === 1,
          nfhsMatched: row.nfhs_matched == null ? null : Number(row.nfhs_matched) === 1,
          coordSource: row.coord_source != null ? asString(row.coord_source) : null,
        }));

        const scored = facilities.filter((f) => f.trustScore != null).length;
        res.json({
          facilities,
          meta: {
            count: facilities.length,
            scored,
            unscored: facilities.length - scored,
            // helpful for the UI when the v4 sync hasn't been set up yet
            hasV4Scores: scored > 0,
          },
        });
      } catch (err) {
        console.error('Failed to fetch facilities from Lakebase:', err);
        res.status(500).json({ error: 'Failed to fetch facilities' });
      }
    });
  });
}
