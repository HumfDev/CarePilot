/**
 * Referral Copilot HTTP API — Lakebase SQL scoring (production) with optional
 * Python bridge fallback for local development.
 */
import type { Application, Request, Response } from 'express';
import type { ReferralCandidate } from '../../shared/referral';
import { callPythonBridge } from '../lib/python-bridge';
import {
  checkLakebaseReferralReady,
  searchReferralCandidatesLakebase,
} from '../lib/lakebase-referral-search';
import {
  getFeedbackForScenario,
  saveNote,
  saveOverride,
  saveReview,
  saveShortlist,
} from '../lib/lakebase-referral-store';
import { parseReferralMessage } from '../lib/referral-parse';
import {
  answerReferralFollowUp,
  classifyReferralIntent,
  summarizeCandidateCard,
  summarizeSearchResults,
} from '../lib/referral-llm';
import { isGenieEnabled, useLakebaseReferral, usePythonBridge } from '../lib/runtime-config';

interface LakebaseQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface AppKitWithReferral {
  server: { extend(fn: (app: Application) => void): void };
  lakebase?: LakebaseQueryable;
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

function lakebaseReady(appkit: AppKitWithReferral): appkit is AppKitWithReferral & { lakebase: LakebaseQueryable } {
  return Boolean(appkit.lakebase) && useLakebaseReferral();
}

async function callBridge(res: Response, op: Parameters<typeof callPythonBridge>[0], payload: unknown) {
  try {
    const result = await callPythonBridge(op, payload);
    if (!result.ok) {
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

export function setupReferralRoutes(appkit: AppKitWithReferral) {
  appkit.server.extend((app) => {
    app.get('/api/referral/status', async (_req, res) => {
      let data_ready = false;
      let facility_count = 0;
      let scored_count = 0;
      if (lakebaseReady(appkit)) {
        const readiness = await checkLakebaseReferralReady(appkit.lakebase);
        data_ready = readiness.ready;
        facility_count = readiness.facilityCount;
        scored_count = readiness.scoredCount;
      }
      res.json({
        ok: true,
        engine: lakebaseReady(appkit) ? 'lakebase_sql' : usePythonBridge() ? 'python_bridge' : 'unconfigured',
        genie_enabled: isGenieEnabled(),
        local_demo: process.env.CAREPILOT_LOCAL_DEMO === '1',
        data_ready,
        facility_count,
        scored_count,
      });
    });

    app.post('/api/referral/parse', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim()) {
        badRequest(res, '`message` is required.');
        return;
      }

      if (lakebaseReady(appkit) || !usePythonBridge()) {
        try {
          const parsed = parseReferralMessage(message);
          if (!parsed.ok) {
            res.status(200).json(parsed);
            return;
          }
          res.json(parsed);
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          console.error('[referral_routes] parse failed:', errMessage);
          res.status(500).json({ ok: false, kind: 'parse_error', error: errMessage });
        }
        return;
      }

      await callBridge(res, 'parse', { message });
    });

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
        location_text: typeof body.location_text === 'string' ? body.location_text : null,
        ranking_priority: typeof body.ranking_priority === 'string' ? body.ranking_priority : 'prioritize_evidence',
        max_distance_km: asNumberOrNull(body.max_distance_km) ?? 75,
        top_n: asNumberOrNull(body.top_n) ?? 10,
        use_feedback_reranking: body.use_feedback_reranking !== false,
      };

      if (lakebaseReady(appkit)) {
        try {
          const readiness = await checkLakebaseReferralReady(appkit.lakebase);
          if (!readiness.ready) {
            res.status(200).json({
              ok: true,
              scenario_id: null,
              feedback_applied: false,
              candidates: [],
              data_not_ready: true,
              message:
                'Facility tables are not synced in this workspace yet. ' +
                `Found ${readiness.facilityCount} facilities and ${readiness.scoredCount} scored rows in Lakebase. ` +
                'Sync healthcare.facilities and healthcare.facility_features_v4 from Unity Catalog, then retry.',
            });
            return;
          }
          const result = await searchReferralCandidatesLakebase(appkit.lakebase, payload);
          res.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[referral_routes] lakebase search failed:', message);
          if (usePythonBridge()) {
            await callBridge(res, 'search', payload);
            return;
          }
          res.status(500).json({ ok: false, kind: 'lakebase_search_error', error: message });
        }
        return;
      }

      await callBridge(res, 'search', payload);
    });

    app.post('/api/referral/shortlist', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id : '';
      const candidate = body.candidate as ReferralCandidate | undefined;
      if (!scenarioId || !candidate?.facility_id) {
        badRequest(res, '`scenario_id` and `candidate` are required.');
        return;
      }

      if (lakebaseReady(appkit)) {
        await saveShortlist(appkit.lakebase, scenarioId, candidate);
        res.json({ ok: true });
        return;
      }
      await callBridge(res, 'shortlist', body);
    });

    app.post('/api/referral/note', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.facility_id || typeof body.note !== 'string') {
        badRequest(res, '`scenario_id`, `facility_id`, and `note` are required.');
        return;
      }
      if (lakebaseReady(appkit)) {
        await saveNote(appkit.lakebase, String(body.scenario_id), String(body.facility_id), body.note);
        res.json({ ok: true });
        return;
      }
      await callBridge(res, 'note', body);
    });

    app.post('/api/referral/review', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.facility_id || !body.status) {
        badRequest(res, '`scenario_id`, `facility_id`, and `status` are required.');
        return;
      }
      const allowed = new Set(['accepted', 'needs_verification', 'rejected']);
      if (typeof body.status !== 'string' || !allowed.has(body.status)) {
        badRequest(res, '`status` must be accepted | needs_verification | rejected.');
        return;
      }
      if (lakebaseReady(appkit)) {
        await saveReview(
          appkit.lakebase,
          String(body.scenario_id),
          String(body.facility_id),
          body.status,
          typeof body.reviewer_note === 'string' ? body.reviewer_note : undefined
        );
        res.json({ ok: true });
        return;
      }
      await callBridge(res, 'review', body);
    });

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
      if (lakebaseReady(appkit)) {
        await saveOverride(
          appkit.lakebase,
          String(body.scenario_id),
          String(body.facility_id),
          Number(body.original_score),
          Number(body.override_score),
          typeof body.reason === 'string' ? body.reason : ''
        );
        res.json({ ok: true });
        return;
      }
      await callBridge(res, 'override', body);
    });

    app.get('/api/referral/workspace/:scenarioId', async (req: Request, res: Response) => {
      const scenarioId = Array.isArray(req.params.scenarioId)
        ? req.params.scenarioId[0]
        : req.params.scenarioId;
      if (!scenarioId) {
        badRequest(res, '`scenarioId` is required.');
        return;
      }
      if (lakebaseReady(appkit)) {
        const feedback = await getFeedbackForScenario(appkit.lakebase, scenarioId);
        res.json({ ok: true, scenario_id: scenarioId, ...feedback });
        return;
      }
      await callBridge(res, 'workspace', { scenario_id: scenarioId });
    });

    app.post('/api/referral/summarize', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.scenario_id || !body.candidate || !body.care_need) {
        badRequest(res, '`scenario_id`, `candidate`, and `care_need` are required.');
        return;
      }
      try {
        const result = await summarizeCandidateCard(lakebaseReady(appkit) ? appkit.lakebase : null, {
          scenario_id: String(body.scenario_id),
          candidate: body.candidate as ReferralCandidate,
          care_need: String(body.care_need),
          care_type: typeof body.care_type === 'string' ? body.care_type : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
        });
        res.json({ ok: true, summary: result.summary, model: result.model, cached: result.cached });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ ok: false, kind: 'llm_error', error: message });
      }
    });

    app.post('/api/referral/summarize-search', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      if (!body.care_need || !Array.isArray(body.candidates) || body.candidates.length === 0) {
        badRequest(res, '`care_need` and a non-empty `candidates` array are required.');
        return;
      }
      try {
        const summary = await summarizeSearchResults({
          care_need: String(body.care_need),
          care_type: typeof body.care_type === 'string' ? body.care_type : undefined,
          location_text: typeof body.location_text === 'string' ? body.location_text : null,
          candidates: body.candidates as ReferralCandidate[],
          feedback_applied: Boolean(body.feedback_applied),
          model: typeof body.model === 'string' ? body.model : undefined,
        });
        res.json({ ok: true, summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ ok: false, kind: 'llm_error', error: message });
      }
    });

    app.post('/api/referral/chat', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim() || !body.care_need || !Array.isArray(body.candidates)) {
        badRequest(res, '`message`, `care_need`, and `candidates` are required.');
        return;
      }
      try {
        const reply = await answerReferralFollowUp({
          message,
          care_need: String(body.care_need),
          candidates: body.candidates as ReferralCandidate[],
          feedback_applied: Boolean(body.feedback_applied),
          model: typeof body.model === 'string' ? body.model : undefined,
        });
        res.json({ ok: true, reply });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ ok: false, kind: 'llm_error', error: message });
      }
    });

    app.post('/api/referral/classify-intent', async (req: Request, res: Response) => {
      const body = isRecord(req.body) ? req.body : {};
      const message = typeof body.message === 'string' ? body.message : '';
      if (!message.trim()) {
        badRequest(res, '`message` is required.');
        return;
      }
      try {
        const intent = await classifyReferralIntent({
          message,
          care_need: String(body.care_need ?? ''),
          candidate_count: Number(body.candidate_count ?? 0),
          top_facility_name:
            typeof body.top_facility_name === 'string' ? body.top_facility_name : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
        });
        res.json({ ok: true, intent });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ ok: false, kind: 'llm_error', error: message });
      }
    });
  });
}
