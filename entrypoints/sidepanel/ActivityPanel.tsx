// A plain-language log of what Orbit just learned, so the live counters can be explained: every
// line is something Instagram's own page loaded because you opened it. Local only.
import { getDb } from '../../src/db/db';
import { relativeTime } from '../../src/ui/badge-model';
import { useLive } from '../../src/ui/hooks';

const SHOWN = 40;

export function ActivityPanel({ viewerId }: { viewerId: string | undefined }) {
  const rows = useLive(
    async () =>
      viewerId
        ? getDb()
            .activity.where('[viewerId+at]')
            .between([viewerId, 0], [viewerId, Number.MAX_SAFE_INTEGER])
            .reverse()
            .limit(SHOWN)
            .toArray()
        : [],
    [viewerId],
  );
  const now = Date.now();
  return (
    <section class="space-y-2 rounded border border-slate-200 p-3">
      <h2 class="font-semibold">Activity</h2>
      <p class="text-xs text-slate-500">
        What Orbit just learned. Each line is data Instagram&apos;s own page loaded because you
        opened that profile or list; Orbit sends nothing to Instagram. If a line doesn&apos;t match
        something you did, tell me.
      </p>
      {!rows || rows.length === 0 ? (
        <p class="text-xs text-slate-400">Nothing yet.</p>
      ) : (
        <ul class="max-h-64 space-y-1 overflow-auto text-xs">
          {rows.map((r) => (
            <li key={r.id} class="flex justify-between gap-2">
              <span class="text-slate-700">{r.text}</span>
              <span class="shrink-0 text-slate-400">{relativeTime(r.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
