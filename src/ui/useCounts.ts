import { useEffect, useState } from 'preact/hooks';
import { getDb } from '../db/db';

export interface Counts {
  nodes: number;
  edges: number;
}

export function useCounts(): Counts | null {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    const db = getDb();
    Promise.all([db.nodes.count(), db.edges.count()])
      .then(([nodes, edges]) => setCounts({ nodes, edges }))
      .catch((err: unknown) => console.warn('[orbit] count failed', err));
  }, []);
  return counts;
}
