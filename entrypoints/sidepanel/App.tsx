import { GuideCard } from '../../src/ui/GuideCard';
import { ResetButton } from '../../src/ui/ResetButton';
import { useActiveViewer, useViewerCounts } from '../../src/ui/hooks';
import { ActivityPanel } from './ActivityPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ImportPanel } from './ImportPanel';

export function App() {
  const viewer = useActiveViewer();
  const counts = useViewerCounts(viewer?.viewerId);
  return (
    <main class="space-y-4 p-4 font-sans text-sm text-slate-800">
      <header class="space-y-1">
        <h1 class="text-lg font-semibold">Orbit Explorer</h1>
        {viewer && (
          <p class="text-xs text-slate-500">
            {counts?.nodes.toLocaleString() ?? '…'} accounts ·{' '}
            {counts?.edges.toLocaleString() ?? '…'} connections known
          </p>
        )}
      </header>

      <GuideCard viewer={viewer} />
      <ImportPanel viewer={viewer} />
      <ActivityPanel viewerId={viewer?.viewerId} />
      <DiagnosticsPanel />
      <ResetButton />

      <p class="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
        All data stays in this browser. Orbit never contacts Instagram on its own.
      </p>
    </main>
  );
}
