import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { getDb } from '../db/db';
import type { DiagnosticRecord } from '../db/db';
import type { ViewerMeta } from '../shared/types';

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
