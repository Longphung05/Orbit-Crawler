import { computeHealth, type Health } from '../capture/diagnostics';
import type { DiagnosticRecord } from '../db/db';
import type { ViewerMeta } from '../shared/types';

const HEALTH_STYLE: Record<Health, { dot: string; label: string }> = {
  unknown: { dot: 'bg-slate-300', label: 'waiting for Instagram' },
  ok: { dot: 'bg-emerald-500', label: 'capturing' },
  degraded: { dot: 'bg-amber-500', label: 'partly broken' },
  broken: { dot: 'bg-red-500', label: 'adapter broken' },
};

export function HealthDot({ records }: { records: readonly DiagnosticRecord[] | undefined }) {
  const health = records ? computeHealth(records) : 'unknown';
  const { dot, label } = HEALTH_STYLE[health];
  return (
    <span
      class="flex items-center gap-1 text-xs text-slate-500"
      title={`Capture adapter: ${label}`}
    >
      <span class={`inline-block h-2 w-2 rounded-full ${dot}`} /> {label}
    </span>
  );
}

/** One line describing which Instagram account Orbit is attached to. */
export function viewerLine(viewer: ViewerMeta | null | undefined): string {
  if (viewer === undefined) return 'Loading…';
  if (!viewer) return 'Open instagram.com while logged in to start.';
  if (!viewer.username)
    return 'Account detected. Open your own profile once so Orbit learns your username.';
  return `Logged in as @${viewer.username}`;
}
