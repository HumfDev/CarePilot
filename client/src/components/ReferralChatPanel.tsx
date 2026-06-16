/**
 * Referral chat panel.
 *
 * Replaces GeniePanel for the Phase 1 `Map | Chat` layout. Users type natural
 * language; the panel calls `/api/referral/parse` + `/api/referral/search`
 * through the `useReferralSearch` hook and renders the assistant transcript.
 *
 * Genie is intentionally NOT depended on for ranking — it can be reattached
 * later as a secondary tab for ad-hoc data queries.
 */
import { ArrowUp, Mic, Plus } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChatMessage, UseReferralSearchReturn } from '../hooks/useReferralSearch';

interface ReferralChatPanelProps {
  referral: UseReferralSearchReturn;
  exampleQueries?: string[];
}

const DEFAULT_EXAMPLES = [
  'dialysis near Jaipur',
  'emergency surgery near Patna',
  'maternity care near Bengaluru',
  'cardiology near Mumbai',
];

function UrgencyBadge({
  urgency_score,
  urgency_label,
  department,
}: {
  urgency_score?: number;
  urgency_label?: string;
  department?: string;
}) {
  if (urgency_score == null) return null;

  const color =
    urgency_score >= 8
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : urgency_score >= 5
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  const dot =
    urgency_score >= 8 ? 'bg-rose-500' : urgency_score >= 5 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${color}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="font-medium">
        Urgency {urgency_score}/10 · {urgency_label ?? 'Routine'}
      </span>
      {department ? <span className="text-neutral-500">· {department}</span> : null}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 shadow-sm">
        {message.text}
      </div>
    </div>
  );
}

export function ReferralChatPanel({ referral, exampleQueries }: ReferralChatPanelProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [referral.messages.length, referral.search.loading]);

  const examples = exampleQueries ?? DEFAULT_EXAMPLES;
  const busy = referral.search.loading || referral.search.summarizing || !!referral.actionPending;
  const showSuggestions = !referral.messages.some((m) => m.role === 'user');

  const submit = async () => {
    if (!draft.trim() || busy) return;
    const text = draft;
    setDraft('');
    await referral.submitMessage(text);
  };

  const submitSuggestion = (query: string) => {
    void referral.submitMessage(query);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-testid="referral-chat-panel">
      {referral.urgencyInfo ? (
        <div className="shrink-0 px-4 pt-2 pb-1">
          <UrgencyBadge {...referral.urgencyInfo} />
        </div>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {referral.messages.map((m, index) => (
          <Fragment key={m.id}>
            <MessageBubble message={m} />
            {showSuggestions && index === 0 && m.role === 'assistant' ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {examples.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={busy}
                    onClick={() => submitSuggestion(q)}
                    className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
          </Fragment>
        ))}
        {referral.search.loading && (
          <div className="flex justify-start">
            <div className="max-w-[60%] animate-pulse rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500">
              Scoring candidates…
            </div>
          </div>
        )}
        {referral.search.summarizing && (
          <div className="flex justify-start">
            <div className="max-w-[60%] animate-pulse rounded-2xl rounded-bl-sm border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-700">
              Llama 4 Maverick is thinking…
            </div>
          </div>
        )}
        {referral.search.error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
            {referral.search.error}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-neutral-200 px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex items-center gap-2"
        >
          <div className="flex min-w-0 flex-1 items-center rounded-full border border-neutral-200 bg-neutral-50 px-1 py-1 shadow-sm">
            <button
              type="button"
              disabled={busy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
              aria-label="Add attachment"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='Try "dialysis near Jaipur"'
              className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none"
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </form>
        <p className="text-[10px] text-neutral-400">
          Not medical advice — verify with a phone call or official website before referral.
        </p>
      </div>
    </div>
  );
}
