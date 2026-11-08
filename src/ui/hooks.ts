import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { getDb } from '../db/db';
import type { DiagnosticRecord } from '../db/db';
import { StatusViewSchema, type StatusView } from '../query/schemas';
import type { ViewerMeta } from '../shared/types';

const STATUS_POLL_MS = 1500;

/** Subscribe to a Dexie query; re-runs when the tables it reads change (in any extension page). */
export function useLive<T>(query: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<{ v: T } | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue({ v }),
      error: (err: unknown) => console.warn('[orbit] live query failed', err),
    });
    return () => sub.unsubscribe();
  }, deps); // caller supplies deps explicitly
  return value?.v;
}

/** The most recently active Instagram account Orbit has detected (Phase 5 sets this). */
export function useActiveViewer(): ViewerMeta | null | undefined {
  return useLive(async () => {
    const all = await getDb().viewers.toArray();
    return all.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))[0] ?? null;
  }, []);
}

export interface Counts {
  nodes: number;
  edges: number;
}

export function useViewerCounts(viewerId: string | undefined): Counts | undefined {
  return useLive(async () => {
    if (!viewerId) return { nodes: 0, edges: 0 };
    const db = getDb();
    const [nodes, edges] = await Promise.all([
      db.nodes.where('viewerId').equals(viewerId).count(),
      db.edges.where('viewerId').equals(viewerId).count(),
    ]);
    return { nodes, edges };
  }, [viewerId]);
}

/** Adapter diagnostics records (global, not per viewer). */
export function useDiagnostics(): DiagnosticRecord[] | undefined {
  return useLive(() => getDb().diagnostics.toArray(), []);
}

/** What the badge is showing right now, polled from the background (local messages only). */
export function useStatus(): StatusView | undefined {
  const [status, setStatus] = useState<StatusView | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const ask = (): void => {
      browser.runtime
        .sendMessage({ type: 'orbit/status' })
        .then((reply: unknown) => {
          const parsed = StatusViewSchema.safeParse(reply);
          if (live && parsed.success) setStatus(parsed.data);
        })
        .catch(() => undefined);
    };
    ask();
    const timer = setInterval(ask, STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return status;
}
