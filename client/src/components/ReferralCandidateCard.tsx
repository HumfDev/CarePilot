/**
 * Referral candidate detail card.
 *
 * Rendered as a modal overlay so it works inside Phase 1's `Map | Chat` shell
 * without claiming layout real estate. It surfaces the full evidence-aware
 * contract that the Python scoring pipeline returns:
 *
 *   - header        — name, type, location, distance
 *   - scores        — raw vs final vs feedback-adjusted, uncertainty, evidence
 *   - reasoning     — recommendation reason + score-cap reason
 *   - evidence      — top snippets with field + matched terms + tier
 *   - URLs          — facility-related / care-need-evidence / unrelated counts
 *   - flags         — missing + suspicious evidence
 *   - actions       — shortlist / review / override / note
 *   - footer        — verification reminder + "not medical advice"
 *
 * The component never recomputes scores. It only displays what the bridge
 * delivered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferralCandidate, ReviewDecision } from '../types/referral';
import type { ReferralSummarizer } from '../types/referral';
import { DEFAULT_SUMMARIZER_LABEL, summarizerDisplayName } from '../hooks/useReferralSearch';

interface ReferralCandidateCardProps {
  candidate: ReferralCandidate | null;
  scenarioId: string | null;
  careNeed: string | null;
  careType: string | null;
  summarizer: ReferralSummarizer;
  llamaModel?: string;
  onClose: () => void;
  onShortlist: (c: ReferralCandidate) => Promise<void> | void;
  onSaveNote: (c: ReferralCandidate, note: string) => Promise<void> | void;
  onReview: (c: ReferralCandidate, status: ReviewDecision) => Promise<void> | void;
  onOverride: (c: ReferralCandidate, score: number, reason: string) => Promise<void> | void;
  actionPending: string | null;
}

/** Public wrapper — controls visibility and remounts the inner card per
 *  candidate so action-form state (note draft, override fields) resets
 *  cleanly without a useEffect-driven setState cascade. */
export function ReferralCandidateCard(props: ReferralCandidateCardProps) {
  if (!props.candidate) return null;
  return <ReferralCandidateCardInner key={props.candidate.facility_id} {...props} candidate={props.candidate} />;
}

interface InnerProps extends Omit<ReferralCandidateCardProps, 'candidate'> {
  candidate: ReferralCandidate;
}

function fmtScore(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function uncertaintyChip(level: string | null | undefined) {
  const text = (level ?? '').toLowerCase();
  if (text.startsWith('low')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (text.startsWith('medium')) return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (text.startsWith('high')) return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-neutral-100 text-neutral-700 ring-neutral-200';
}

function ScoreCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`text-base font-semibold ${accent ?? 'text-neutral-900'}`}>{value}</span>
    </div>
  );
}

function CandidateAiSummary({
  candidate,
  scenarioId,
  careNeed,
  careType,
  summarizer,
  llamaModel,
}: {
  candidate: ReferralCandidate;
  scenarioId: string | null;
  careNeed: string | null;
  careType: string | null;
  summarizer: ReferralSummarizer;
  llamaModel?: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [engineLabel, setEngineLabel] = useState(
    summarizerDisplayName(summarizer, llamaModel ?? DEFAULT_SUMMARIZER_LABEL)
  );

  const load = useCallback(
    async (force = false) => {
      if (!scenarioId || !careNeed) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/referral/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenario_id: scenarioId,
            candidate,
            care_need: careNeed,
            care_type: careType ?? 'specialist',
            summarizer,
            force_regenerate: force,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          summary?: string;
          cached?: boolean;
          engine?: string;
          model?: string;
          error?: string;
        };
        if (!data.ok || !data.summary) {
          setError(data.error ?? 'AI summary unavailable.');
          setSummary(null);
          return;
        }
        setSummary(data.summary);
        setCached(!!data.cached);
        setEngineLabel(
          data.engine === 'genie'
            ? 'Genie'
            : summarizerDisplayName('llama', data.model ?? llamaModel)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI summary request failed.');
      } finally {
        setLoading(false);
      }
    },
    [candidate, scenarioId, careNeed, careType, summarizer, llamaModel]
  );

  useEffect(() => {
    void load();
  }, [load, summarizer]);

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
          AI card summary · {engineLabel}
        </h3>
        <button
          type="button"
          disabled={loading || !scenarioId}
          onClick={() => {
            void load(true);
          }}
          className="rounded-md border border-indigo-200 px-2 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
        >
          Regenerate
        </button>
      </div>
      {loading ? (
        <p className="animate-pulse text-xs text-indigo-600">{engineLabel} is thinking…</p>
      ) : error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : summary ? (
        <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-700">{summary}</p>
      ) : (
        <p className="text-xs text-neutral-500">No AI summary yet.</p>
      )}
      {cached && !loading ? (
        <p className="mt-2 text-[10px] text-neutral-500">Cached summary · verify before referral.</p>
      ) : null}
    </section>
  );
}

function clampCardPosition(x: number, y: number, cardW: number, cardH: number) {
  const pad = 16;
  const minVisible = 72;
  return {
    x: Math.max(pad - cardW + minVisible, Math.min(window.innerWidth - pad - minVisible, x)),
    y: Math.max(pad, Math.min(window.innerHeight - pad - Math.min(cardH, minVisible), y)),
  };
}

function useDraggableCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return undefined;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const el = cardRef.current;
      const w = el?.offsetWidth ?? 768;
      const h = el?.offsetHeight ?? 400;
      setPos(clampCardPosition(d.originX + (e.clientX - d.startX), d.originY + (e.clientY - d.startY), w, h));
    }
    function onUp() {
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  const onDragHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const el = cardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const origin = pos ?? { x: rect.left, y: rect.top };
      if (!pos) setPos(origin);
      dragRef.current = { startX: e.clientX, startY: e.clientY, originX: origin.x, originY: origin.y };
      setDragging(true);
    },
    [pos],
  );

  return { cardRef, pos, dragging, onDragHandlePointerDown };
}

function ReferralCandidateCardInner({
  candidate,
  scenarioId,
  careNeed,
  careType,
  summarizer,
  llamaModel,
  onClose,
  onShortlist,
  onSaveNote,
  onReview,
  onOverride,
  actionPending,
}: InnerProps) {
  const [note, setNote] = useState('');
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const { cardRef, pos, dragging, onDragHandlePointerDown } = useDraggableCard();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const location = [candidate.clean_city, candidate.clean_district, candidate.clean_state].filter(Boolean).join(' · ');

  const finalScore = candidate.feedback_adjusted_score ?? candidate.final_recommendation_score;
  const rawScore = candidate.raw_recommendation_score;
  const showRaw =
    rawScore != null &&
    candidate.final_recommendation_score != null &&
    Math.abs(rawScore - candidate.final_recommendation_score) >= 1;
  const feedbackDelta = candidate.feedback_delta ?? 0;
  const evidenceSnippets = candidate.evidence_snippets ?? [];
  const missingFlags = candidate.missing_evidence_flags ?? [];
  const suspiciousFlags = candidate.suspicious_evidence_flags ?? [];
  const facilityUrls = candidate.facility_related_urls ?? [];
  const careUrls = candidate.care_need_evidence_urls ?? [];
  const unrelatedUrls = candidate.unrelated_source_urls ?? [];
  const unrelatedRatio = candidate.source_url_classification?.unrelated_ratio ?? null;
  const breakdown = Array.isArray(candidate.score_breakdown) ? candidate.score_breakdown : [];

  return (
    <>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        className={`fixed z-[2001] flex max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl ring-1 ring-black/5 ${
          dragging ? 'select-none' : ''
        }`}
        style={pos ? { left: pos.x, top: pos.y } : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {/* Header — drag handle */}
        <div
          className={`flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-4 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onPointerDown={onDragHandlePointerDown}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              <span className="text-neutral-600" aria-hidden="true">
                ⠿
              </span>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-700">
                {candidate.rank}
              </span>
              <span>Candidate for review</span>
              <span className="normal-case text-neutral-600">· drag to move</span>
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-neutral-900">{candidate.facility_name}</h2>
            <p className="text-xs text-neutral-400">
              {candidate.clean_facility_type ?? 'facility'}
              {location ? ` · ${location}` : ''}
              {candidate.distance_km != null ? ` · ${candidate.distance_km.toFixed(1)} km` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            aria-label="Close candidate card"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          <CandidateAiSummary
            candidate={candidate}
            scenarioId={scenarioId}
            careNeed={careNeed}
            careType={careType}
            summarizer={summarizer}
            llamaModel={llamaModel}
          />

          {/* Scores */}
          <section>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ScoreCell label="Final score" value={fmtScore(finalScore)} accent="text-indigo-600" />
              {showRaw ? <ScoreCell label="Raw score" value={fmtScore(rawScore)} /> : null}
              {feedbackDelta !== 0 ? (
                <ScoreCell
                  label="Feedback delta"
                  value={`${feedbackDelta > 0 ? '+' : ''}${fmtScore(feedbackDelta)}`}
                  accent={feedbackDelta > 0 ? 'text-emerald-700' : 'text-rose-700'}
                />
              ) : null}
              <ScoreCell label="Evidence" value={fmtScore(candidate.evidence_strength_score, 0)} />
              <ScoreCell label="Disease match" value={fmtScore(candidate.disease_match_score, 0)} />
              <ScoreCell label="Baseline trust" value={fmtScore(candidate.baseline_trust_score, 1)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${uncertaintyChip(candidate.uncertainty_level)}`}
              >
                {candidate.uncertainty_level ?? 'Uncertainty n/a'}
              </span>
              {candidate.score_cap_reason ? (
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700">
                  cap: {candidate.score_cap_reason}
                </span>
              ) : null}
              {candidate.feedback_reason ? (
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                  feedback: {candidate.feedback_reason}
                </span>
              ) : null}
            </div>
          </section>

          {/* Reasoning */}
          {candidate.recommendation_reason ? (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Recommendation reason
              </h3>
              <p className="whitespace-pre-line rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-700">
                {candidate.recommendation_reason}
              </p>
            </section>
          ) : null}

          {/* Evidence */}
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Top evidence snippets
            </h3>
            {evidenceSnippets.length ? (
              <ul className="space-y-2">
                {evidenceSnippets.slice(0, 3).map((snippet) => (
                  <li
                    key={`${snippet.field ?? 'field'}|${(snippet.matched_terms ?? []).join(',')}|${(snippet.text ?? '').slice(0, 40)}`}
                    className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-500">
                      {snippet.field ? <span>{snippet.field}</span> : null}
                      {snippet.tier ? (
                        <span className="rounded bg-neutral-100 px-1 text-neutral-700">{snippet.tier}</span>
                      ) : null}
                      {snippet.confidence ? <span>· {snippet.confidence}</span> : null}
                      {snippet.matched_terms?.length ? (
                        <span className="ml-auto text-neutral-500">{snippet.matched_terms.join(', ')}</span>
                      ) : null}
                    </div>
                    <p className="text-neutral-200">{snippet.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                No direct evidence snippets — verify before referral.
              </p>
            )}
          </section>

          {/* URL classification */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UrlBucket label="Facility-related URLs" urls={facilityUrls} tone="emerald" />
            <UrlBucket label="Care-need evidence URLs" urls={careUrls} tone="indigo" />
            <UrlBucket
              label="Unrelated URLs"
              urls={unrelatedUrls}
              tone="rose"
              hint={unrelatedRatio != null ? `${Math.round(unrelatedRatio * 100)}% of all source URLs` : undefined}
            />
          </section>

          {/* Flags */}
          {missingFlags.length || suspiciousFlags.length ? (
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {missingFlags.length ? <FlagsBlock title="Missing evidence" flags={missingFlags} tone="amber" /> : null}
              {suspiciousFlags.length ? (
                <FlagsBlock title="Suspicious evidence" flags={suspiciousFlags} tone="rose" />
              ) : null}
            </section>
          ) : null}

          {/* Score breakdown (compact) */}
          {breakdown.length ? (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Score breakdown
              </h3>
              <ul className="grid grid-cols-2 gap-1 text-[11px] text-neutral-300 sm:grid-cols-3">
                {breakdown.map((entry, idx) => {
                  const label = entry.component ?? `comp ${idx + 1}`;
                  return (
                    <li
                      key={`${label}|${entry.contribution ?? idx}`}
                      className="rounded-md bg-neutral-50 px-2 py-1"
                    >
                      <span className="text-neutral-500">{label}</span>
                      <span className="ml-2 font-medium text-neutral-900">{fmtScore(entry.contribution, 2)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/* Actions */}
          <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Planner actions</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void onShortlist(candidate);
                }}
                disabled={!!actionPending}
                className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
              >
                Save to shortlist
              </button>
              <button
                type="button"
                onClick={() => {
                  void onReview(candidate, 'accepted');
                }}
                disabled={!!actionPending}
                className="rounded-md bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
              >
                Mark accepted
              </button>
              <button
                type="button"
                onClick={() => {
                  void onReview(candidate, 'needs_verification');
                }}
                disabled={!!actionPending}
                className="rounded-md bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 disabled:opacity-50"
              >
                Needs verification
              </button>
              <button
                type="button"
                onClick={() => {
                  void onReview(candidate, 'rejected');
                }}
                disabled={!!actionPending}
                className="rounded-md bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Add planner note
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Confirmed dialysis chairs by phone"
                  className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!note.trim() || !!actionPending}
                  onClick={() => {
                    const text = note.trim();
                    if (!text) return;
                    void Promise.resolve(onSaveNote(candidate, text)).then(() => setNote(''));
                  }}
                  className="rounded-md border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Save note
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Manual override (final score)
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(e.target.value)}
                  placeholder="0–100"
                  className="w-24 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 focus:border-indigo-400 focus:outline-none"
                />
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Reason (e.g. phone-verified)"
                  className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!overrideScore || !overrideReason.trim() || !!actionPending}
                  onClick={() => {
                    const score = Number(overrideScore);
                    if (!Number.isFinite(score)) return;
                    void Promise.resolve(onOverride(candidate, score, overrideReason.trim())).then(() => {
                      setOverrideScore('');
                      setOverrideReason('');
                    });
                  }}
                  className="rounded-md border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Save override
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 bg-neutral-50 px-6 py-3 text-[11px] text-neutral-500">
          Verification step: confirm the matched evidence with a phone call or the official website before referring a
          patient. <span className="text-neutral-500">Not medical advice — planner-facing referral copilot only.</span>
        </div>
      </div>
    </>
  );
}

function UrlBucket({
  label,
  urls,
  tone,
  hint,
}: {
  label: string;
  urls: string[];
  tone: 'emerald' | 'indigo' | 'rose';
  hint?: string;
}) {
  const palette = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  }[tone];
  return (
    <div className={`rounded-md border ${palette} px-3 py-2 text-[11px]`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
        <span className="font-semibold text-neutral-900">{urls.length}</span>
      </div>
      {hint ? <div className="mt-0.5 text-[10px] opacity-80">{hint}</div> : null}
      {urls.slice(0, 2).map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate text-[10px] text-neutral-700 hover:underline"
        >
          {url}
        </a>
      ))}
      {urls.length > 2 ? <div className="mt-0.5 text-[10px] opacity-60">+{urls.length - 2} more</div> : null}
    </div>
  );
}

function FlagsBlock({ title, flags, tone }: { title: string; flags: string[]; tone: 'amber' | 'rose' }) {
  const palette = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  }[tone];
  return (
    <div className={`rounded-md border ${palette} px-3 py-2 text-[11px]`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-neutral-700">
        {flags.map((flag) => (
          <li key={flag}>{flag}</li>
        ))}
      </ul>
    </div>
  );
}
