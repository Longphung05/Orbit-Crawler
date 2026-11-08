// Adapter health (§6.2 self-test, §8.4 popup dot, §9 schema drift).
// Stores counters, endpoint templates and value-free shapes only: never user data.
import { ADAPTER_VERSION, type AdapterOutcome } from '../adapters/instagram';
import type { DiagnosticRecord, OrbitDB } from '../db';

export type Health = 'unknown' | 'ok' | 'degraded' | 'broken';

export async function recordOutcome(
  db: OrbitDB,
  outcome: AdapterOutcome,
  at: number,
): Promise<void> {
  if (outcome.status === 'ignored') return;
  const key = outcome.payloadType;
  await db.transaction('rw', db.diagnostics, async () => {
    const prev = await db.diagnostics.get(key);
    // A new adapter version starts a clean slate: old failures may already be fixed.
    const base: DiagnosticRecord =
      prev && prev.adapterVersion === ADAPTER_VERSION
        ? prev
        : { key, adapterVersion: ADAPTER_VERSION, ok: 0, failed: 0 };
    const next: DiagnosticRecord = { ...base, endpoint: outcome.endpoint };
    if (outcome.status === 'ok') {
      next.ok++;
      next.lastOkAt = at;
    } else {
      next.failed++;
      next.lastFailAt = at;
      next.lastError = outcome.error;
      next.lastShape = outcome.shape;
    }
    await db.diagnostics.put(next);
  });
}

/** The page-text "Followed by" fallback worked once more (§6.2). */
export async function recordDomMutuals(db: OrbitDB, at: number): Promise<void> {
  await db.transaction('rw', db.diagnostics, async () => {
    const prev = await db.diagnostics.get('dom_mutuals');
    const base =
      prev && prev.adapterVersion === ADAPTER_VERSION
        ? prev
        : { key: 'dom_mutuals', adapterVersion: ADAPTER_VERSION, ok: 0, failed: 0 };
    await db.diagnostics.put({ ...base, ok: base.ok + 1, lastOkAt: at });
  });
}

export async function recordViewerDetection(
  db: OrbitDB,
  strategy: string,
  found: boolean,
  at: number,
): Promise<void> {
  await db.diagnostics.put({
    key: 'viewer',
    adapterVersion: ADAPTER_VERSION,
    ok: found ? 1 : 0,
    failed: found ? 0 : 1,
    ...(found ? { lastOkAt: at } : { lastFailAt: at }),
    detail: strategy,
  });
}

/** Red when the most recent result for a payload type was a failure (§9). */
export function isFailing(r: DiagnosticRecord): boolean {
  return r.lastFailAt !== undefined && (r.lastOkAt === undefined || r.lastFailAt > r.lastOkAt);
}

export function computeHealth(records: readonly DiagnosticRecord[]): Health {
  const payloads = records.filter(
    (r) => r.key !== 'viewer' && r.key !== 'dom_mutuals' && r.adapterVersion === ADAPTER_VERSION,
  );
  if (payloads.length === 0) return 'unknown';
  const failing = payloads.filter(isFailing).length;
  if (failing === 0) return 'ok';
  return failing === payloads.length ? 'broken' : 'degraded';
}

/** What the "Copy diagnostics" button puts on the clipboard: safe to paste anywhere. */
export function diagnosticsReport(records: readonly DiagnosticRecord[]): string {
  return JSON.stringify(
    {
      orbitAdapter: ADAPTER_VERSION,
      records: records.map((r) => ({
        key: r.key,
        adapterVersion: r.adapterVersion,
        ok: r.ok,
        failed: r.failed,
        failing: isFailing(r),
        endpoint: r.endpoint,
        lastError: r.lastError,
        detail: r.detail,
        lastShape: r.lastShape,
      })),
    },
    null,
    2,
  );
}
