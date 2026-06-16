import { useEffect, useState } from 'react';
import { ReferralChatPanel } from './ReferralChatPanel';
import { GeniePanel } from './GeniePanel';
import type { UseReferralSearchReturn } from '../hooks/useReferralSearch';

interface RightChatPanelProps {
  referral: UseReferralSearchReturn;
}

type PanelTab = 'referral' | 'genie';

export function RightChatPanel({ referral }: RightChatPanelProps) {
  const [tab, setTab] = useState<PanelTab>('referral');
  const [genieEnabled, setGenieEnabled] = useState(false);

  useEffect(() => {
    void fetch('/api/referral/status')
      .then((r) => r.json())
      .then((data: { genie_enabled?: boolean }) => {
        if (data.genie_enabled) setGenieEnabled(true);
      })
      .catch(() => {
        // local demo — Genie tab hidden unless explicitly enabled server-side
      });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-testid="right-chat-panel">
      {genieEnabled ? (
        <div className="flex shrink-0 border-b border-neutral-200 bg-white px-3 py-2">
          <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab('referral')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                tab === 'referral' ? 'bg-white text-indigo-700 shadow-sm' : 'text-neutral-600'
              }`}
              data-testid="tab-referral-chat"
            >
              Referral
            </button>
            <button
              type="button"
              onClick={() => setTab('genie')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                tab === 'genie' ? 'bg-white text-indigo-700 shadow-sm' : 'text-neutral-600'
              }`}
              data-testid="tab-genie"
            >
              Genie data
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {tab === 'genie' && genieEnabled ? (
          <GeniePanel />
        ) : (
          <ReferralChatPanel referral={referral} />
        )}
      </div>
    </div>
  );
}
