import { useActiveViewer, useViewerCounts } from '../../src/ui/hooks';

async function openSidePanel(): Promise<void> {
  const win = await browser.windows.getCurrent();
  if (win.id !== undefined) await browser.sidePanel.open({ windowId: win.id });
  window.close();
}

export function App() {
  const viewer = useActiveViewer();
  const counts = useViewerCounts(viewer?.viewerId);
  return (
    <main class="w-72 space-y-3 p-4 font-sans text-sm text-slate-800">
      <header class="flex items-center justify-between">
        <h1 class="text-base font-semibold">Orbit</h1>
        <span
          class="flex items-center gap-1 text-xs text-slate-500"
          title="Capture adapter arrives in Phase 5"
        >
          <span class="inline-block h-2 w-2 rounded-full bg-slate-300" /> adapter inactive
        </span>
      </header>
      <dl class="grid grid-cols-2 gap-2">
        <div class="rounded bg-slate-100 p-2">
          <dt class="text-xs text-slate-500">Accounts</dt>
          <dd class="text-lg font-semibold">{counts?.nodes.toLocaleString() ?? '…'}</dd>
        </div>
        <div class="rounded bg-slate-100 p-2">
          <dt class="text-xs text-slate-500">Connections</dt>
          <dd class="text-lg font-semibold">{counts?.edges.toLocaleString() ?? '…'}</dd>
        </div>
      </dl>
      <p class="text-xs text-slate-500">
        {viewer ? `Logged in as @${viewer.username}` : 'No account detected yet.'}
      </p>
      <button
        type="button"
        class="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700"
        onClick={() => void openSidePanel()}
      >
        Open explorer
      </button>
    </main>
  );
}
