import { useEffect } from 'react';
import { GenieChat } from '@databricks/appkit-ui/react';

const GENIE_ALIAS = 'healthcare';
const BUILD_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

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
    <div className="genie-dark flex h-full min-h-0 flex-col bg-black" data-testid="genie-panel">
      <div className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-base font-semibold text-white">Healthcare Data Queries</h1>
        <p className="mt-0.5 text-xs text-neutral-500">
          Ask questions about facilities, NFHS-5 health indicators, and PIN codes
        </p>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
          <GenieChat
            alias={GENIE_ALIAS}
            placeholder="Ask about facilities, health indicators, or PIN codes..."
            className="h-full min-h-0 bg-neutral-950 text-white [&_*]:border-neutral-800"
          />
        </div>
      </div>
    </div>
  );
}
