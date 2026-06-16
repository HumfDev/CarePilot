import type { Application } from 'express';

const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID ?? 'b2bb07abff382b79';
const LLM_ENDPOINT = 'databricks-meta-llama-3-3-70b-instruct';

const FACILITY_SQL = `
  SELECT facility_id, facility_name, original_city, original_state,
         original_pincode, resolved_state, resolved_district,
         resolved_latitude, resolved_longitude,
         facilityTypeId, operatorTypeId, yearEstablished,
         numberDoctors, capacity,
         description, specialties, capability, procedure, equipment,
         trust_score_v2, source_credibility_score, source_count
  FROM workspace.default.facility_feature_table_v4
  WHERE resolved_latitude IS NOT NULL
    AND resolved_longitude IS NOT NULL
    AND resolved_latitude BETWEEN 6 AND 37
    AND resolved_longitude BETWEEN 68 AND 97
  LIMIT ?
`;

const RESOLVE_SYSTEM_PROMPT = `You are a medical triage classifier for an Indian healthcare facility search engine.

Given a patient's free-text description of their health need, return a JSON object with:
- "keywords": array of 3-8 lowercase medical terms to match against facility specialties/capabilities (e.g. ophthalmology, cataract, retina, eye care)
- "careType": one of "emergency", "specialist", "maternity", "general"
- "label": short human-readable label (e.g. "Eye care / Ophthalmology")

Rules:
- "emergency" only when the patient needs immediate life-saving care (trauma, heart attack, stroke, ICU)
- "maternity" for pregnancy, delivery, gynecology, neonatal
- "specialist" for chronic conditions, cancer, organ-specific care, surgery
- "general" for mild symptoms, routine checkups, unclear needs
- Keywords must be terms likely found in hospital specialties/capabilities text

Respond ONLY with valid JSON, no explanation.`;

interface LlmCondition {
  keywords: string[];
  careType: 'emergency' | 'specialist' | 'maternity' | 'general';
  label: string;
}

async function resolveConditionWithLlm(query: string): Promise<LlmCondition> {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  if (!host || !token) throw new Error('Missing Databricks credentials');

  const resp = await fetch(`${host}/serving-endpoints/${LLM_ENDPOINT}/invocations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: RESOLVE_SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      max_tokens: 256,
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM call failed ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content ?? '{}';
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  return JSON.parse(json) as LlmCondition;
}

interface SqlColumn { name: string }
interface SqlResult {
  status: { state: string; error?: { message: string } };
  manifest?: { schema: { columns: SqlColumn[] } };
  result?: { data_array?: unknown[][] };
  statement_id?: string;
}

async function runSqlStatement(sql: string, limit: number): Promise<Record<string, unknown>[]> {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  if (!host || !token) throw new Error('DATABRICKS_HOST and DATABRICKS_TOKEN must be set');

  const statement = sql.replace('?', String(limit));

  const submitResp = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      warehouse_id: WAREHOUSE_ID,
      statement,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
    }),
  });

  if (!submitResp.ok) {
    const text = await submitResp.text();
    throw new Error(`SQL submit failed ${submitResp.status}: ${text.slice(0, 200)}`);
  }

  let data = (await submitResp.json()) as SqlResult;

  while (data.status.state === 'PENDING' || data.status.state === 'RUNNING') {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await fetch(`${host}/api/2.0/sql/statements/${data.statement_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    data = (await pollResp.json()) as SqlResult;
  }

  if (data.status.state !== 'SUCCEEDED') {
    throw new Error(`SQL failed: ${data.status.error?.message ?? data.status.state}`);
  }

  const columns = data.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows = data.result?.data_array ?? [];
  return rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i] ?? null])),
  );
}

interface AppKitWithServer {
  server: { extend(fn: (app: Application) => void): void };
}

export function setupMapRoutes(appkit: AppKitWithServer) {
  appkit.server.extend((app) => {
    app.get('/api/map/facilities', async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 10000);
      try {
        const rows = await runSqlStatement(FACILITY_SQL, limit);
        res.json({ facilities: rows });
      } catch (err) {
        console.error('Failed to fetch facilities:', err);
        res.status(500).json({ error: 'Failed to fetch facilities' });
      }
    });

    app.post('/api/map/resolve-condition', async (req, res) => {
      const query = String((req.body as Record<string, unknown>)?.query ?? '').trim();
      if (!query) {
        res.status(400).json({ error: 'query is required' });
        return;
      }
      try {
        const result = await resolveConditionWithLlm(query);
        res.json(result);
      } catch (err) {
        console.error('LLM resolve-condition failed:', err);
        res.status(500).json({ error: 'LLM unavailable' });
      }
    });

    app.post('/api/map/commute-time', async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const originLat = Number(body.originLat);
      const originLng = Number(body.originLng);
      const destLat = Number(body.destLat);
      const destLng = Number(body.destLng);

      if ([originLat, originLng, destLat, destLng].some((v) => !Number.isFinite(v))) {
        res.status(400).json({ error: 'originLat, originLng, destLat, destLng are required' });
        return;
      }

      try {
        // OSRM expects coordinates as lng,lat
        const url = `http://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
        const osrmResp = await fetch(url);
        if (!osrmResp.ok) {
          res.status(502).json({ error: `OSRM returned ${osrmResp.status}` });
          return;
        }

        const data = (await osrmResp.json()) as {
          code: string;
          routes?: Array<{ duration: number; distance: number }>;
        };

        if (data.code !== 'Ok' || !data.routes?.length) {
          res.status(400).json({ error: `No route found (OSRM: ${data.code})` });
          return;
        }

        const { duration, distance } = data.routes[0];
        const minutes = Math.round(duration / 60);
        const durationText =
          minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
        const distanceKm = (distance / 1000).toFixed(1);

        res.json({ durationText, durationSeconds: Math.round(duration), distanceText: `${distanceKm} km` });
      } catch (err) {
        console.error('Commute time failed:', err);
        res.status(500).json({ error: 'Routing service unavailable' });
      }
    });
  });
}
