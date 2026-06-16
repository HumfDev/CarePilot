import { useEffect } from 'react';
import { GenieChat } from '@databricks/appkit-ui/react';
import { AppBrand } from './AppBrand';

const GENIE_ALIAS = 'healthcare';
const BUILD_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

const GENIE_EXAMPLES = [
  'How many facilities are in Rajasthan?',
  'NFHS anemia prevalence by state',
  'PIN codes with highest facility density',
];

function clearConversationUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('conversationId');
  window.history.replaceState({}, '', url.toString());
}

function initGenieStorage() {
  if (localStorage.getItem('appkit:genie:version') !== BUILD_VERSION) {
    const savedAlias = localStorage.getItem('appkit:genie:alias');
    Object.keys(localStorage)
      .filter((k) => k.startsWith('appkit:genie:'))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('appkit:genie:version', BUILD_VERSION);
    if (savedAlias) localStorage.setItem('appkit:genie:alias', savedAlias);
    clearConversationUrl();
  }
}

export function GeniePanel() {
  useEffect(() => {
    initGenieStorage();
  }, []);

  return (
    <div className="genie-panel flex h-full min-h-0 flex-col bg-white" data-testid="genie-panel">
      <div className="shrink-0 border-b border-neutral-200 px-4 py-3">
        <AppBrand variant="compact" />
        <p className="mt-2 text-xs text-neutral-500">
          Genie data queries — facilities, NFHS-5, and{' '}
          <span className="text-indigo-600">PIN-level health indicators</span>
        </p>
      </div>

      <div className="min-h-0 flex-1 px-4 py-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-slate-50">
          <GenieChat
            alias={GENIE_ALIAS}
            placeholder="Ask about facilities, health indicators, or PIN codes..."
            className="genie-chat-light h-full min-h-0 bg-slate-50 text-neutral-900"
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-200 px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {GENIE_EXAMPLES.map((q) => (
            <span
              key={q}
              className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] text-neutral-600"
            >
              {q}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">
          Answers come from your connected Genie space — verify SQL results before clinical use.
        </p>
      </div>
    </div>
  );
}
