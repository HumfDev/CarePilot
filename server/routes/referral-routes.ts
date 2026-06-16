/**
 * Referral Copilot HTTP API.
 *
 * Express routes that thin-wrap the Python scoring + persistence pipeline via
 * `python-bridge.ts`. The contract is documented in
 * `docs/referral_ui_integration_plan.md` and must be kept stable — the
 * frontend renders these responses as-is and never recomputes scores.
 */
import type { Application, Request, Response } from 'express';
import { callPythonBridge } from '../lib/python-bridge';

interface AppKitWithServer {
  server: { extend(fn: (app: Application) => void): void };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function badRequest(res: Response, message: string) {
  res.status(400).json({ ok: false, kind: 'bad_request', error: message });
}

async function callBridge(res: Response, op: Parameters<typeof callPythonBridge>[0], payload: unknown) {
  try {
    const result = await callPythonBridge(op, payload);
    if (!result.ok) {
      // Treat clarification needs as 200 so the UI can show the assistant
      // message. Other errors are 4xx/5xx.
      if (result.kind === 'needs_clarification' || result.kind === 'empty_message') {
        res.status(200).json(result);
      } else {
        res.status(result.kind === 'missing_params' || result.kind === 'bad_request' ? 400 : 500).json(result);
      }
      return;
    }
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[referral_routes] ${op} failed:`, message);
    res.status(502).json({ ok: false, kind: 'bridge_error', error: message });
  }
}

export function setupReferralRoutes(appkit: AppKitWithServer) {
  appkit.server.extend((app) => {
    // POST /api/referral/parse  — NL → structured search params
    app.post('/api/referral/parse', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim()) {
        badRequest(res, '`message` is required.');
        return;
      }
      await callBridge(res, 'parse', { message });
    });

    // POST /api/referral/search — run the scoring pipeline
    app.post('/api/referral/search', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const care_need = typeof body.care_need === 'string' ? body.care_need : '';
      const user_lat = asNumberOrNull(body.user_lat);
      const user_lon = asNumberOrNull(body.user_lon);

      if (!care_need || user_lat == null || user_lon == null) {
        badRequest(res, 'care_need, user_lat, and user_lon are required.');
        return;
      }

      const payload = {
        care_need,
        care_type: typeof body.care_type === 'string' ? body.care_type : 'specialist',
        user_lat,
        user_lon,
        ranking_priority: typeof body.ranking_priority === 'string' ? body.ranking_priority : 'prioritize_evidence',
        max_distance_km: asNumberOrNull(body.max_distance_km) ?? 75,
        top_n: asNumberOrNull(body.top_n) ?? 10,
        use_feedback_reranking: body.use_feedback_reranking !== false,
      };

      await callBridge(res, 'search', payload);
    });

    // POST /api/referral/shortlist
    app.post('/api/referral/shortlist', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.candidate) {
        badRequest(res, '`scenario_id` and `candidate` are required.');
        return;
      }
      await callBridge(res, 'shortlist', body);
    });

    // POST /api/referral/note
    app.post('/api/referral/note', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.facility_id || typeof body.note !== 'string') {
        badRequest(res, '`scenario_id`, `facility_id`, and `note` are required.');
        return;
      }
      await callBridge(res, 'note', body);
    });

    // POST /api/referral/review
    app.post('/api/referral/review', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.facility_id || !body.status) {
        badRequest(res, '`scenario_id`, `facility_id`, and `status` are required.');
        return;
      }
      const allowedStatuses = new Set(['accepted', 'needs_verification', 'rejected']);
      if (typeof body.status !== 'string' || !allowedStatuses.has(body.status)) {
        badRequest(res, '`status` must be accepted | needs_verification | rejected.');
        return;
      }
      await callBridge(res, 'review', body);
    });

    // POST /api/referral/override
    app.post('/api/referral/override', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (
        !body.scenario_id ||
        !body.facility_id ||
        asNumberOrNull(body.original_score) == null ||
        asNumberOrNull(body.override_score) == null
      ) {
        badRequest(res, '`scenario_id`, `facility_id`, `original_score`, `override_score` are required.');
        return;
      }
      await callBridge(res, 'override', body);
    });

    // GET /api/referral/workspace/:scenarioId
    app.get('/api/referral/workspace/:scenarioId', async (req: Request, res: Response) => {
      const scenarioId = req.params.scenarioId;
      if (!scenarioId) {
        badRequest(res, '`scenarioId` is required.');
        return;
      }
      await callBridge(res, 'workspace', { scenario_id: scenarioId });
    });

    // POST /api/referral/summarize — Llama card summary (cached in SQLite)
    app.post('/api/referral/summarize', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.candidate || !body.care_need) {
        badRequest(res, '`scenario_id`, `candidate`, and `care_need` are required.');
        return;
      }
      try {
        const result = await callPythonBridge('summarize', body, { timeoutMs: 60_000 });
        if (!result.ok) {
          res.status(result.kind === 'llm_error' ? 502 : 400).json(result);
          return;
        }
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[referral_routes] summarize failed:', message);
        res.status(502).json({ ok: false, kind: 'bridge_error', error: message });
      }
    });

    // POST /api/referral/summarize-search — Llama chat reply after search
    app.post('/api/referral/summarize-search', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.care_need || !Array.isArray(body.candidates) || body.candidates.length === 0) {
        badRequest(res, '`care_need` and a non-empty `candidates` array are required.');
        return;
      }
      try {
        const result = await callPythonBridge('summarize_search', body, { timeoutMs: 60_000 });
        if (!result.ok) {
          res.status(result.kind === 'llm_error' ? 502 : 400).json(result);
          return;
        }
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[referral_routes] summarize-search failed:', message);
        res.status(502).json({ ok: false, kind: 'bridge_error', error: message });
      }
    });

    // POST /api/referral/chat — follow-up questions about current ranked results
    app.post('/api/referral/chat', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim()) {
        badRequest(res, '`message` is required.');
        return;
      }
      if (!body.care_need || !Array.isArray(body.candidates) || body.candidates.length === 0) {
        badRequest(res, '`care_need` and a non-empty `candidates` array are required.');
        return;
      }
      try {
        const result = await callPythonBridge('chat', body, { timeoutMs: 60_000 });
        if (!result.ok) {
          res.status(result.kind === 'llm_error' ? 502 : 400).json(result);
          return;
        }
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[referral_routes] chat failed:', message);
        res.status(502).json({ ok: false, kind: 'bridge_error', error: message });
      }
    });

    // POST /api/referral/classify-intent — Llama routes follow-up vs new search
    app.post('/api/referral/classify-intent', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim()) {
        badRequest(res, '`message` is required.');
        return;
      }
      try {
        const result = await callPythonBridge('classify_intent', body, { timeoutMs: 30_000 });
        if (!result.ok) {
          res.status(result.kind === 'llm_error' ? 502 : 400).json(result);
          return;
        }
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[referral_routes] classify-intent failed:', message);
        res.status(502).json({ ok: false, kind: 'bridge_error', error: message });
      }
    });
  });
}
