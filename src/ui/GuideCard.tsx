import type { ViewerMeta } from '../shared/types';
import { buildGuide, type GuideTone } from './guide';
import { useStatus } from './hooks';

const TONE: Record<GuideTone, { box: string; dot: string }> = {
  wait: { box: 'border-slate-200 bg-slate-50', dot: 'bg-slate-400' },
  next: { box: 'border-amber-200 bg-amber-50', dot: 'bg-amber-500' },
  ok: { box: 'border-emerald-200 bg-emerald-50', dot: 'bg-emerald-500' },
};

/** What Orbit has detected and what to do next, updated as you browse. */
export function GuideCard({ viewer }: { viewer: ViewerMeta | null | undefined }) {
  const status = useStatus();
  const guide = buildGuide({ viewer, viewing: status?.viewing });
  const tone = TONE[guide.tone];
  return (
    <section class={`space-y-1 rounded border p-2 text-xs ${tone.box}`} aria-live="polite">
      <h2 class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <span class={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
        {guide.title}
      </h2>
      {guide.lines.map((l) => (
        <p key={l} class="text-slate-700">
          {l}
        </p>
      ))}
    </section>
  );
}
