import { GeniePanel } from '../components/GeniePanel';

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

      <main className="flex min-h-0 flex-1 flex-col bg-black">
        <div className="border-b border-neutral-800 px-8 py-5">
          <h1 className="text-xl font-semibold text-white">Healthcare Data Queries</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Ask questions about facilities, NFHS-5 health indicators, and PIN codes
          </p>
        </div>
        <GeniePanel />
      </main>
    </div>
  );
}
