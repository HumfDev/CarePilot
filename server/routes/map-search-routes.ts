/**
 * Map search APIs — work in local demo without Lakebase.
 * Used by the left sidebar: condition resolution + OSRM commute time.
 */
import type { Application } from 'express';
import { fetchOsrmDrivingRoute } from '../lib/osrm-client';

interface AppKitLike {
  server: { extend(fn: (app: Application) => void): void };
}

const LLM_ENDPOINT = process.env.DATABRICKS_LLM_ENDPOINT ?? 'databricks-meta-llama-3-3-70b-instruct';

const RESOLVE_SYSTEM_PROMPT = `You are a medical triage classifier for an Indian healthcare facility search engine.

Given a patient's free-text description of their health need, return a JSON object with:
- "keywords": array of 3-8 lowercase medical terms to match against facility specialties/capabilities
- "careType": one of "emergency", "specialist", "maternity", "general"
- "label": short human-readable label

Respond ONLY with valid JSON, no explanation.`;

const DISEASE_KEYWORDS: Record<string, string[]> = {
  dialysis: ['dialysis', 'hemodialysis', 'nephrology', 'renal', 'kidney'],
  heart: ['cardiology', 'cardiac', 'heart', 'ecg', 'chest pain'],
  pregnancy: ['maternity', 'pregnancy', 'obstetrics', 'gynecology', 'delivery'],
  emergency: ['emergency', 'trauma', 'icu', 'ambulance', 'casualty'],
  cancer: ['oncology', 'cancer', 'chemotherapy', 'radiotherapy'],
  diabetes: ['diabetes', 'diabetic', 'endocrinology', 'blood sugar'],
};

function ruleBasedResolve(query: string) {
  const q = query.trim().toLowerCase();
  for (const [key, keywords] of Object.entries(DISEASE_KEYWORDS)) {
    if (q.includes(key) || keywords.some((kw) => q.includes(kw))) {
      const careType =
        key === 'emergency' ? 'emergency' : key === 'pregnancy' ? 'maternity' : 'specialist';
      return { keywords, careType, label: key.replace(/_/g, ' ') };
    }
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  return {
    keywords: tokens.length ? tokens : ['general', 'medicine'],
    careType: 'general',
    label: query.trim() || 'General care',
  };
}

async function resolveConditionWithLlm(query: string) {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  if (!host || !token) return ruleBasedResolve(query);

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

  if (!resp.ok) return ruleBasedResolve(query);

  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  const parsed = JSON.parse(json) as { keywords?: string[]; careType?: string; label?: string };
  if (!parsed.keywords?.length) return ruleBasedResolve(query);
  return {
    keywords: parsed.keywords,
    careType: parsed.careType ?? 'general',
    label: parsed.label ?? query,
  };
}

export function setupMapSearchRoutes(appkit: AppKitLike) {
  appkit.server.extend((app) => {
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
        console.error('resolve-condition failed:', err);
        res.json(ruleBasedResolve(query));
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
        const route = await fetchOsrmDrivingRoute([originLat, originLng], [destLat, destLng]);
        if (!route) {
          res.status(502).json({ error: 'OSRM routing failed' });
          return;
        }
        const minutes = Math.round(route.duration_minutes);
        const durationText =
          minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
        res.json({
          durationText,
          durationSeconds: Math.round(route.duration_minutes * 60),
          distanceText: `${route.distance_km.toFixed(1)} km`,
        });
      } catch (err) {
        console.error('commute-time failed:', err);
        res.status(500).json({ error: 'Routing service unavailable' });
      }
    });
  });
}
