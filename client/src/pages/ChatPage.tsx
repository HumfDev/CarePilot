import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { GeniePanel } from '../components/GeniePanel';
import { IndiaMapPanel } from '../components/IndiaMapPanel';

export function ChatPage() {
  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-black px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
          <span className="text-sm font-medium text-white">CarePilot Healthcare Assistant</span>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          Genie · Lakebase · Unity Catalog
        </span>
      </header>

      <main className="min-h-0 flex-1 bg-black">
        <PanelGroup direction="horizontal" className="h-full w-full">
          <Panel defaultSize={55} minSize={30}>
            <IndiaMapPanel />
          </Panel>
          <PanelResizeHandle className="w-1 bg-neutral-800 transition-colors hover:bg-neutral-600" />
          <Panel defaultSize={45} minSize={30}>
            <GeniePanel />
          </Panel>
        </PanelGroup>
      </main>
    </div>
  );
}
