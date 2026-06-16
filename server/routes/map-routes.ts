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

export function setupMapRoutes(appkit: AppKitWithLakebase) {
  appkit.server.extend((app) => {
    app.get('/api/map/facilities', async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 10000);

      try {
        const result = await appkit.lakebase.query(
          `SELECT unique_id, name, latitude, longitude,
                  address_city, "address_stateOrRegion"
           FROM carepilot_lakebase.healthcare.facilities
           WHERE latitude IS NOT NULL
             AND longitude IS NOT NULL
             AND latitude BETWEEN 6 AND 37
             AND longitude BETWEEN 68 AND 97
           LIMIT $1`,
          [limit],
        );

        const facilities = result.rows.map((row) => ({
          id: asString(row.unique_id, 'unknown'),
          name: asString(row.name, 'Unknown facility'),
          lat: Number(row.latitude),
          lng: Number(row.longitude),
          city: row.address_city != null ? asString(row.address_city) : null,
          state: row.address_stateOrRegion != null ? asString(row.address_stateOrRegion) : null,
        }));

        res.json({ facilities });
      } catch (err) {
        console.error('Failed to fetch facilities from Lakebase:', err);
        res.status(500).json({ error: 'Failed to fetch facilities' });
      }
    });
  });
}
