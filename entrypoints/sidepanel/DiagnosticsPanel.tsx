// Adapter health detail (§6.2 self-test). "Copy diagnostics" yields endpoint templates, counters,
// error messages and value-free shapes: safe to paste into a bug report.
import { useState } from 'preact/hooks';
import { diagnosticsReport, isFailing } from '../../src/capture/diagnostics';
import { HealthDot } from '../../src/ui/health';
import { useDiagnostics } from '../../src/ui/hooks';

const LABELS: Record<string, string> = {
  viewer: 'Account detection',
  friendship_list: 'Follower / following lists',
  user_info: 'Profiles',
  web_profile_info: 'Profiles (classic)',
  graphql_profile: 'Profiles (GraphQL)',
  friendship_status: 'Follow status',
};

function ago(ms: number | undefined): string {
  if (ms === undefined) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function DiagnosticsPanel() {
  const records = useDiagnostics();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    if (!records) return;
    await navigator.clipboard.writeText(diagnosticsReport(records));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section class="space-y-2 rounded border border-slate-200 p-3">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Capture status</h2>
        <HealthDot records={records} />
      </div>
      {!records || records.length === 0 ? (
        <p class="text-xs text-slate-500">
          Nothing seen yet. Browse Instagram normally: open profiles and their follower/following
          lists. Orbit only reads what the page already loads; it never opens anything itself.
        </p>
      ) : (
        <ul class="space-y-1 text-xs">
          {records
            .slice()
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((r) => {
              const failing = isFailing(r);
              return (
                <li key={r.key} class="flex items-start justify-between gap-2">
                  <span>
                    <span class={failing ? 'text-red-700' : 'text-slate-700'}>
                      {LABELS[r.key] ?? r.key}
                    </span>
                    {r.key === 'viewer' ? (
                      <span class="text-slate-400">
                        {' '}
                        · {r.detail === 'none' ? 'not found' : 'found'}
                      </span>
                    ) : (
                      <span class="text-slate-400">
                        {' '}
                        · {r.ok} ok{r.failed ? `, ${r.failed} failed` : ''}
                      </span>
                    )}
                    {failing && r.lastError && (
                      <span class="block text-red-600">{r.lastError}</span>
                    )}
                  </span>
                  <span class="shrink-0 text-slate-400">{ago(r.lastOkAt ?? r.lastFailAt)}</span>
                </li>
              );
            })}
        </ul>
      )}
      <button
        type="button"
        disabled={!records?.length}
        class="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
        onClick={() => void copy()}
      >
        {copied ? 'Copied' : 'Copy diagnostics'}
      </button>
      <p class="text-[11px] text-slate-400">
        Contains only endpoint patterns, counts, and data shapes, never usernames or ids.
      </p>
    </section>
  );
}
