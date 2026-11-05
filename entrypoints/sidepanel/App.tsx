import { useCounts } from '../../src/ui/useCounts';

export function App() {
  const counts = useCounts();
  return (
    <main class="space-y-4 p-4 font-sans text-sm text-slate-800">
      <h1 class="text-lg font-semibold">Orbit Explorer</h1>
      <p class="text-slate-600">
        Your network map is empty. Import your Instagram data export (coming in Phase 4) or browse
        Instagram normally once passive capture is enabled (Phase 5).
      </p>
      <p class="text-xs text-slate-500">
        {counts ? `${counts.nodes} accounts · ${counts.edges} connections known` : 'Loading…'}
      </p>
      <p class="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
        All data stays in this browser. Orbit never contacts Instagram on its own.
      </p>
    </main>
  );
}
