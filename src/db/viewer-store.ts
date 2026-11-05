// Per-viewer repository (CLAUDE.md §5.3, §6, §9). Every read and write is scoped to one viewerId.
import { z } from 'zod';
import { DEFAULT_SETTINGS, OrbitSettingsSchema, type OrbitSettings } from '../shared/settings';
import {
  PLACEHOLDER_PREFIX,
  type Coverage,
  type Edge,
  type EdgeSource,
  type UserNode,
  type ViewerMeta,
} from '../shared/types';
import { historyKey, type OrbitDB } from './db';
import {
  ListDirectionSchema,
  NodeObservationSchema,
  TimestampSchema,
  UsernameSchema,
  type ListDirection,
  type NodeObservation,
} from './validation';

export function placeholderId(username: string): string {
  return `${PLACEHOLDER_PREFIX}${username.toLowerCase()}`;
}

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

const LIST_SOURCE: Record<ListDirection, EdgeSource> = {
  following: 'following_list',
  followers: 'followers_list',
  mutuals: 'mutuals',
};

const COVERAGE_RANK: Record<Coverage, number> = { none: 0, partial: 1, complete: 2 };
const maxCoverage = (a: Coverage, b: Coverage): Coverage =>
  COVERAGE_RANK[a] >= COVERAGE_RANK[b] ? a : b;
const maxOpt = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

export interface EdgeInput {
  from: string;
  to: string;
  source: EdgeSource;
}

export interface ListPageInput {
  ownerId: string;
  direction: ListDirection;
  rows: NodeObservation[];
  observedAt: number;
}

export interface ListPageResult {
  /** Edges newly created by this page. */
  added: number;
  /** Rows not stored because a hub's follower list hit the cap (§7.4). */
  droppedByCap: number;
}

export interface CompleteListInput {
  ownerId: string;
  direction: 'following' | 'followers';
  /** Edges in scope not confirmed since this time are marked stale. */
  sessionStartedAt: number;
  completedAt: number;
}

export interface CompleteListResult {
  completed: boolean;
  markedStale: number;
}

export interface ExportSnapshotInput {
  following: string[];
  followers: string[];
  /** When Instagram generated the export; the cutoff for stale marking. */
  exportedAt: number;
}

export class ViewerStore {
  constructor(
    readonly db: OrbitDB,
    readonly viewerId: string,
  ) {
    if (!viewerId) throw new Error('viewerId required');
  }

  // ── Viewer / settings ─────────────────────────────────────────────────────

  async touchViewer(username: string, at: number): Promise<ViewerMeta> {
    UsernameSchema.parse(username);
    return this.db.transaction('rw', this.db.viewers, async () => {
      const existing = await this.db.viewers.get(this.viewerId);
      const meta: ViewerMeta = { ...existing, viewerId: this.viewerId, username, lastActiveAt: at };
      await this.db.viewers.put(meta);
      return meta;
    });
  }

  async getSettings(): Promise<OrbitSettings> {
    const rec = await this.db.settings.get(this.viewerId);
    const fields = Object.entries(rec ?? {}).filter(([k]) => k !== 'viewerId');
    // Each invalid stored field falls back to its default rather than crashing.
    const merged: OrbitSettings = { ...DEFAULT_SETTINGS };
    for (const [k, value] of fields) {
      const parsed = OrbitSettingsSchema.partial().safeParse({ [k]: value });
      if (parsed.success) Object.assign(merged, parsed.data);
    }
    return merged;
  }

  async saveSettings(patch: Partial<OrbitSettings>): Promise<OrbitSettings> {
    const valid = OrbitSettingsSchema.partial().parse(patch);
    const next = { ...(await this.getSettings()), ...valid };
    await this.db.settings.put({ viewerId: this.viewerId, ...next });
    return next;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  getNode(id: string): Promise<UserNode | undefined> {
    return this.db.nodes.get([this.viewerId, id]);
  }

  getEdge(from: string, to: string): Promise<Edge | undefined> {
    return this.db.edges.get([this.viewerId, edgeId(from, to)]);
  }

  edgesFrom(id: string): Promise<Edge[]> {
    return this.db.edges.where('[viewerId+from]').equals([this.viewerId, id]).toArray();
  }

  edgesTo(id: string): Promise<Edge[]> {
    return this.db.edges.where('[viewerId+to]').equals([this.viewerId, id]).toArray();
  }

  allNodes(): Promise<UserNode[]> {
    return this.db.nodes.where('viewerId').equals(this.viewerId).toArray();
  }

  allEdges(): Promise<Edge[]> {
    return this.db.edges.where('viewerId').equals(this.viewerId).toArray();
  }

  async counts(): Promise<{ nodes: number; edges: number }> {
    const [nodes, edges] = await Promise.all([
      this.db.nodes.where('viewerId').equals(this.viewerId).count(),
      this.db.edges.where('viewerId').equals(this.viewerId).count(),
    ]);
    return { nodes, edges };
  }

  /**
   * Resolve a username to a node: current holder first, then a placeholder, then accounts that
   * used to have it (old @mentions, §9 Identity).
   */
  async findByUsername(username: string): Promise<UserNode | undefined> {
    const key = username.toLowerCase();
    const holders = await this.db.nodes
      .where('[viewerId+usernameKey]')
      .equals([this.viewerId, key])
      .toArray();
    const current = holders
      .filter((n) => !n.isPlaceholder && n.usernameSupersededAt === undefined)
      .sort((a, b) => b.usernameSeenAt - a.usernameSeenAt)[0];
    if (current) return current;
    const placeholder = holders.find((n) => n.isPlaceholder);
    if (placeholder) return placeholder;
    const former = await this.db.nodes
      .where('historyKeys')
      .equals(historyKey(this.viewerId, key))
      .toArray();
    return former.sort((a, b) => b.usernameSeenAt - a.usernameSeenAt)[0] ?? holders[0];
  }

  // ── Node upserts + placeholder merging ────────────────────────────────────

  /** Insert or update observed accounts. Merges export placeholders on first id sighting. */
  async upsertNodes(observations: readonly NodeObservation[], observedAt: number): Promise<void> {
    const at = TimestampSchema.parse(observedAt);
    const rows = z.array(NodeObservationSchema).parse(observations);
    await this.db.transaction('rw', this.db.nodes, this.db.edges, async () => {
      for (const o of rows) await this.upsertOne(o, at);
    });
  }

  private async upsertOne(o: NodeObservation, at: number): Promise<void> {
    const v = this.viewerId;
    const key = o.username.toLowerCase();
    const existing = await this.db.nodes.get([v, o.id]);
    const isNewName = !existing || existing.usernameKey !== key;
    /** When this id was last seen under a *different* name (rename detection). */
    const priorOtherNameSeenAt = existing && isNewName ? existing.usernameSeenAt : undefined;

    let node: UserNode;
    if (!existing) {
      node = {
        viewerId: v,
        id: o.id,
        username: o.username,
        usernameKey: key,
        usernameSeenAt: at,
        usernameHistory: [],
        historyKeys: [],
        firstSeenAt: at,
        lastSeenAt: at,
        followingCoverage: 'none',
        followersCoverage: 'none',
      };
    } else {
      node = { ...existing, lastSeenAt: Math.max(existing.lastSeenAt, at) };
      if (isNewName) {
        if (at >= existing.usernameSeenAt) {
          // Renamed: the new name leaves history (if it was there), the old one enters it.
          const hk = historyKey(v, key);
          const renamed: UserNode = {
            ...node,
            username: o.username,
            usernameKey: key,
            usernameSeenAt: at,
            usernameHistory: node.usernameHistory.filter((h) => h.toLowerCase() !== key),
            historyKeys: node.historyKeys.filter((k) => k !== hk),
          };
          delete renamed.usernameSupersededAt;
          node = this.withHistory(renamed, existing.username);
        } else {
          // A late, older observation: it's a former name.
          node = this.withHistory(node, o.username);
        }
      } else {
        node.username = o.username; // keep latest display casing
        node.usernameSeenAt = Math.max(existing.usernameSeenAt, at);
      }
    }
    // Latest observed attributes win; undefined fields keep what we had.
    if (!existing || at >= existing.lastSeenAt) {
      for (const k of [
        'fullName',
        'profilePicUrl',
        'isPrivate',
        'isVerified',
        'followerCount',
        'followingCount',
      ] as const) {
        if (o[k] !== undefined) (node[k] as unknown) = o[k];
      }
      // Seeing a profile again means it's reachable again.
      if (node.unavailable) {
        delete node.unavailable;
        delete node.unavailableAt;
      }
    }

    if (node.usernameKey === key && isNewName) {
      await this.supersedeOtherHolders(key, o.id, at);
      const ph = await this.db.nodes.get([v, placeholderId(key)]);
      // Merge unless this id was seen under another name *after* the export recorded `key`:
      // then the export's `key` belonged to someone else (username reassignment, §9).
      if (ph && (priorOtherNameSeenAt === undefined || priorOtherNameSeenAt < ph.usernameSeenAt)) {
        node = this.absorbPlaceholder(node, ph);
        await this.rewriteEdges(ph.id, node.id);
        await this.db.nodes.delete([v, ph.id]);
      }
    }
    await this.db.nodes.put(node);
  }

  private withHistory(node: UserNode, username: string): UserNode {
    const key = username.toLowerCase();
    if (key === node.usernameKey || node.usernameHistory.some((h) => h.toLowerCase() === key)) {
      return node;
    }
    return {
      ...node,
      usernameHistory: [...node.usernameHistory, username],
      historyKeys: [...node.historyKeys, historyKey(this.viewerId, key)],
    };
  }

  private async supersedeOtherHolders(key: string, holderId: string, at: number): Promise<void> {
    const others = await this.db.nodes
      .where('[viewerId+usernameKey]')
      .equals([this.viewerId, key])
      .toArray();
    for (const other of others) {
      if (other.id === holderId || other.isPlaceholder) continue;
      if (other.usernameSupersededAt !== undefined || other.usernameSeenAt > at) continue;
      await this.db.nodes.put({ ...other, usernameSupersededAt: at });
    }
  }

  private absorbPlaceholder(node: UserNode, ph: UserNode): UserNode {
    return {
      ...node,
      firstSeenAt: Math.min(node.firstSeenAt, ph.firstSeenAt),
      followingCoverage: maxCoverage(node.followingCoverage, ph.followingCoverage),
      followersCoverage: maxCoverage(node.followersCoverage, ph.followersCoverage),
      followingCompleteAt: maxOpt(node.followingCompleteAt, ph.followingCompleteAt),
      followersCompleteAt: maxOpt(node.followersCompleteAt, ph.followersCompleteAt),
    };
  }

  /** Repoint every edge touching `oldId` to `newId`, merging duplicates and dropping self-loops. */
  private async rewriteEdges(oldId: string, newId: string): Promise<void> {
    const v = this.viewerId;
    const touching = [...(await this.edgesFrom(oldId)), ...(await this.edgesTo(oldId))];
    for (const e of touching) {
      await this.db.edges.delete([v, e.id]);
      const from = e.from === oldId ? newId : e.from;
      const to = e.to === oldId ? newId : e.to;
      if (from === to) continue;
      const id = edgeId(from, to);
      const clash = await this.db.edges.get([v, id]);
      await this.db.edges.put(
        clash ? mergeEdges(clash, { ...e, id, from, to }) : { ...e, id, from, to },
      );
    }
  }

  // ── Placeholders (export import, §6.1) ────────────────────────────────────

  /**
   * Map usernames to node ids: an existing current holder if known, else a placeholder
   * (created if needed). `exportedAt` records when the export said this name was in use.
   */
  async resolveUsernames(
    usernames: readonly string[],
    exportedAt: number,
  ): Promise<Map<string, string>> {
    const at = TimestampSchema.parse(exportedAt);
    const names = z.array(UsernameSchema).parse(usernames);
    const keys = [...new Set(names.map((u) => u.toLowerCase()))];
    const v = this.viewerId;
    return this.db.transaction('rw', this.db.nodes, async () => {
      const holders = await this.db.nodes
        .where('[viewerId+usernameKey]')
        .anyOf(keys.map((k) => [v, k]))
        .toArray();
      const real = new Map<string, UserNode>();
      const placeholders = new Map<string, UserNode>();
      for (const n of holders) {
        if (n.isPlaceholder) placeholders.set(n.usernameKey, n);
        else if (n.usernameSupersededAt === undefined) {
          const cur = real.get(n.usernameKey);
          if (!cur || n.usernameSeenAt > cur.usernameSeenAt) real.set(n.usernameKey, n);
        }
      }
      const out = new Map<string, string>();
      const writes: UserNode[] = [];
      for (const key of keys) {
        const r = real.get(key);
        if (r) {
          out.set(key, r.id);
          continue;
        }
        const id = placeholderId(key);
        const ph = placeholders.get(key);
        writes.push(
          ph
            ? {
                ...ph,
                usernameSeenAt: Math.max(ph.usernameSeenAt, at),
                lastSeenAt: Math.max(ph.lastSeenAt, at),
              }
            : {
                viewerId: v,
                id,
                username: key,
                usernameKey: key,
                usernameSeenAt: at,
                usernameHistory: [],
                historyKeys: [],
                isPlaceholder: true,
                firstSeenAt: at,
                lastSeenAt: at,
                followingCoverage: 'none',
                followersCoverage: 'none',
              },
        );
        out.set(key, id);
      }
      await this.db.nodes.bulkPut(writes);
      return out;
    });
  }

  /**
   * Apply the viewer's own followers/following from an official export: a complete snapshot at
   * `exportedAt`, so edges last confirmed before then and absent from it become stale.
   */
  async applyExportSnapshot(input: ExportSnapshotInput, now: number): Promise<void> {
    const { exportedAt } = input;
    const ids = await this.resolveUsernames([...input.following, ...input.followers], exportedAt);
    const idOf = (u: string): string => {
      const id = ids.get(u.toLowerCase());
      if (id === undefined) throw new Error(`unresolved username: ${u}`);
      return id;
    };
    const v = this.viewerId;
    const edges: EdgeInput[] = [
      ...input.following.map((u) => ({ from: v, to: idOf(u), source: 'export' as const })),
      ...input.followers.map((u) => ({ from: idOf(u), to: v, source: 'export' as const })),
    ];
    await this.upsertEdges(edges, exportedAt);
    for (const direction of ['following', 'followers'] as const) {
      await this.completeList({
        ownerId: v,
        direction,
        sessionStartedAt: exportedAt,
        completedAt: now,
      });
    }
    await this.db.transaction('rw', this.db.viewers, async () => {
      const meta = await this.db.viewers.get(v);
      await this.db.viewers.put({
        username: '',
        ...meta,
        viewerId: v,
        importedExportAt: maxOpt(meta?.importedExportAt, exportedAt),
      });
    });
  }

  // ── Edges ─────────────────────────────────────────────────────────────────

  /** Insert edges or refresh their lastConfirmedAt. Re-observing an edge un-stales it. */
  async upsertEdges(inputs: readonly EdgeInput[], observedAt: number): Promise<number> {
    const at = TimestampSchema.parse(observedAt);
    const v = this.viewerId;
    return this.db.transaction('rw', this.db.edges, async () => {
      const valid = inputs.filter((e) => e.from && e.to && e.from !== e.to);
      const unique = [...new Map(valid.map((e) => [edgeId(e.from, e.to), e])).values()];
      const keys = unique.map((e): [string, string] => [v, edgeId(e.from, e.to)]);
      const existing = await this.db.edges.bulkGet(keys);
      let added = 0;
      const writes = unique.map((e, i): Edge => {
        const ex = existing[i];
        const fresh: Edge = {
          viewerId: v,
          id: edgeId(e.from, e.to),
          from: e.from,
          to: e.to,
          source: e.source,
          firstSeenAt: at,
          lastConfirmedAt: at,
          stale: false,
        };
        if (!ex) {
          added++;
          return fresh;
        }
        return mergeEdges(ex, fresh);
      });
      await this.db.edges.bulkPut(writes);
      return added;
    });
  }

  /**
   * One page of a followers/following/mutuals list the human loaded. Upserts the rows, adds
   * edges, bumps coverage to at least `partial`, and enforces the hub follower-list cap.
   */
  async recordListPage(input: ListPageInput): Promise<ListPageResult> {
    const direction = ListDirectionSchema.parse(input.direction);
    const at = TimestampSchema.parse(input.observedAt);
    const rows = z.array(NodeObservationSchema).parse(input.rows);
    const { ownerId } = input;
    const settings = await this.getSettings();

    return this.db.transaction('rw', this.db.nodes, this.db.edges, async () => {
      await this.upsertNodes(rows, at);
      const inbound = direction !== 'following';
      const owner = await this.getNode(ownerId);

      let candidates = rows.filter((r) => r.id !== ownerId);
      let droppedByCap = 0;
      const isHub = (owner?.followerCount ?? 0) > settings.hubFollowerThreshold;
      if (inbound && isHub) {
        const existingIds = new Set((await this.edgesTo(ownerId)).map((e) => e.from));
        const room = Math.max(0, settings.hubFollowerListCap - existingIds.size);
        const fresh = candidates.filter((r) => !existingIds.has(r.id));
        const kept = new Set(fresh.slice(0, room).map((r) => r.id));
        droppedByCap = fresh.length - kept.size;
        candidates = candidates.filter((r) => existingIds.has(r.id) || kept.has(r.id));
      }

      const added = await this.upsertEdges(
        candidates.map((r) =>
          inbound
            ? { from: r.id, to: ownerId, source: LIST_SOURCE[direction] }
            : { from: ownerId, to: r.id, source: LIST_SOURCE[direction] },
        ),
        at,
      );

      if (owner && direction !== 'mutuals') {
        const field = direction === 'following' ? 'followingCoverage' : 'followersCoverage';
        const next: UserNode = { ...owner, [field]: maxCoverage(owner[field], 'partial') };
        if (droppedByCap > 0) next.followersCapped = true;
        await this.db.nodes.put(next);
      }
      return { added, droppedByCap };
    });
  }

  /**
   * The human scrolled a list to its end (§9 Data freshness). Marks in-scope edges not confirmed
   * since `sessionStartedAt` as stale. Never call this for partial lists. Capped hub lists and
   * mutuals lists can never be complete.
   */
  async completeList(input: CompleteListInput): Promise<CompleteListResult> {
    const sessionStartedAt = TimestampSchema.parse(input.sessionStartedAt);
    const completedAt = TimestampSchema.parse(input.completedAt);
    const { ownerId, direction } = input;
    return this.db.transaction('rw', this.db.nodes, this.db.edges, async () => {
      const owner = await this.getNode(ownerId);
      if (direction === 'followers' && owner?.followersCapped) {
        return { completed: false, markedStale: 0 };
      }
      const scope =
        direction === 'following' ? await this.edgesFrom(ownerId) : await this.edgesTo(ownerId);
      const toStale = scope
        .filter((e) => !e.stale && e.lastConfirmedAt < sessionStartedAt)
        .map((e): Edge => ({ ...e, stale: true, staleAt: completedAt }));
      await this.db.edges.bulkPut(toStale);
      if (owner) {
        const next: UserNode =
          direction === 'following'
            ? { ...owner, followingCoverage: 'complete', followingCompleteAt: completedAt }
            : { ...owner, followersCoverage: 'complete', followersCompleteAt: completedAt };
        await this.db.nodes.put(next);
      }
      return { completed: true, markedStale: toStale.length };
    });
  }

  // ── Account states ────────────────────────────────────────────────────────

  /** Deactivated/deleted/banned/blocking: keep edges, exclude from paths (§9 Identity). */
  async markUnavailable(id: string, at: number): Promise<void> {
    const ts = TimestampSchema.parse(at);
    await this.db.transaction('rw', this.db.nodes, async () => {
      const node = await this.getNode(id);
      if (node) await this.db.nodes.put({ ...node, unavailable: true, unavailableAt: ts });
    });
  }

  /** Per-viewer wipe (§8.3). Other viewers' data is untouched. */
  async wipe(): Promise<void> {
    const v = this.viewerId;
    await this.db.transaction(
      'rw',
      [this.db.nodes, this.db.edges, this.db.viewers, this.db.settings],
      async () => {
        await this.db.nodes.where('viewerId').equals(v).delete();
        await this.db.edges.where('viewerId').equals(v).delete();
        await this.db.viewers.delete(v);
        await this.db.settings.delete(v);
      },
    );
  }
}

/** Combine two records of the same edge. Newer confirmation decides source and staleness. */
export function mergeEdges(a: Edge, b: Edge): Edge {
  const newer = b.lastConfirmedAt >= a.lastConfirmedAt ? b : a;
  // A confirmation at/after the edge went stale revives it; a late, older one doesn't.
  const staleAt = maxOpt(a.stale ? a.staleAt : undefined, b.stale ? b.staleAt : undefined);
  const stale = staleAt !== undefined && newer.lastConfirmedAt < staleAt;
  const merged: Edge = {
    ...newer,
    firstSeenAt: Math.min(a.firstSeenAt, b.firstSeenAt),
    lastConfirmedAt: newer.lastConfirmedAt,
    stale,
  };
  if (stale && staleAt !== undefined) merged.staleAt = staleAt;
  else delete merged.staleAt;
  return merged;
}
