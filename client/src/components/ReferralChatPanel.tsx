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
import { useEffect, useRef, useState } from 'react';
import { AppBrand } from './AppBrand';
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

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white shadow-sm">
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

  const submit = async () => {
    if (!draft.trim() || busy) return;
    const text = draft;
    setDraft('');
    await referral.submitMessage(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-testid="referral-chat-panel">
      <div className="shrink-0 border-b border-neutral-200 px-4 py-3">
        <AppBrand variant="compact" />
        <p className="mt-2 text-xs text-neutral-500">
          Evidence-aware ranking + <span className="text-indigo-600">Databricks Llama 4 Maverick</span> summaries
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {referral.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {referral.search.loading && (
          <div className="flex justify-start">
            <div className="max-w-[60%] animate-pulse rounded-2xl rounded-bl-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
              Scoring candidates…
            </div>
          </div>
        )}
        {referral.search.summarizing && (
          <div className="flex justify-start">
            <div className="max-w-[60%] animate-pulse rounded-2xl rounded-bl-sm border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
              Llama 4 Maverick is thinking…
            </div>
          </div>
        )}
        {referral.search.error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {referral.search.error}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-neutral-200 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => {
                void referral.submitMessage(q);
              }}
              className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='Try "dialysis near Jaipur"'
            className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-400 focus:outline-none"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Send
          </button>
        </form>
        <p className="text-[10px] text-neutral-500">
          Not medical advice — verify with a phone call or official website before referral.
        </p>
      </div>
    </div>
  );
}
