import { viewerLine } from '../../src/ui/health';
import { useActiveViewer, useViewerCounts } from '../../src/ui/hooks';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ImportPanel } from './ImportPanel';

export function App() {
  const viewer = useActiveViewer();
  const counts = useViewerCounts(viewer?.viewerId);
  return (
    <main class="space-y-4 p-4 font-sans text-sm text-slate-800">
      <header class="space-y-1">
        <h1 class="text-lg font-semibold">Orbit Explorer</h1>
        <p class="text-xs text-slate-500">{viewerLine(viewer)}</p>
        {viewer && (
          <p class="text-xs text-slate-500">
            {counts?.nodes.toLocaleString() ?? '…'} accounts ·{' '}
            {counts?.edges.toLocaleString() ?? '…'} connections known
          </p>
        )}
      </header>

      <DiagnosticsPanel />
      <ImportPanel viewer={viewer} />

      <p class="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
        All data stays in this browser. Orbit never contacts Instagram on its own.
      </p>
    </main>
  );
}
