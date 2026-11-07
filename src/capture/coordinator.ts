// Background-side capture orchestration: validate messages, attribute them to the right viewer,
// interpret with the adapter, apply to the DB, and record adapter health. One queue, in order.
import { interpretResponse, isInstagramUrl, type AdapterOutcome } from '../adapters/instagram';
import { ViewerStore, UsernameSchema, type OrbitDB } from '../db';
import { recordOutcome, recordViewerDetection } from './diagnostics';
import { RuntimeMessageSchema, type RuntimeMessage } from './messages';
import { applyEvents, type ApplySummary } from './pipeline';
import { ListSessions } from './sessions';

export interface SenderInfo {
  tabId?: number;
  url?: string;
  /** sender.id === our own extension id */
  fromSelf: boolean;
}

type ResponseMessage = Extract<RuntimeMessage, { type: 'orbit/response' }>;

/** Responses that arrive before the tab's account is known wait this long, at most this many. */
const PENDING_MAX = 100;
const PENDING_TTL_MS = 60_000;

export interface ProcessedResult {
  viewerId: string;
  tabId: number;
  outcome: AdapterOutcome;
  summary?: ApplySummary;
}

export class CaptureCoordinator {
  readonly sessions = new ListSessions();
  private readonly tabViewer = new Map<number, string>();
  private readonly pending = new Map<number, ResponseMessage[]>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: OrbitDB,
    private readonly onProcessed?: (r: ProcessedResult) => void,
  ) {}

  viewerForTab(tabId: number): string | undefined {
    return this.tabViewer.get(tabId);
  }

  /** Tabs currently attributed to an account (or to any account, when none is given). */
  tabsForViewer(viewerId?: string): number[] {
    return [...this.tabViewer]
      .filter(([, v]) => viewerId === undefined || v === viewerId)
      .map(([tabId]) => tabId);
  }

  /** Entry point for runtime messages. Resolves when the message has been fully handled. */
  handle(raw: unknown, sender: SenderInfo): Promise<void> {
    if (!sender.fromSelf || sender.tabId === undefined) return Promise.resolve();
    if (!sender.url || !isInstagramUrl(sender.url)) return Promise.resolve();
    const parsed = RuntimeMessageSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve();
    const tabId = sender.tabId;
    const msg = parsed.data;
    return this.enqueue(async () => {
      if (msg.type === 'orbit/viewer') await this.onViewer(tabId, msg);
      else await this.onResponse(tabId, msg);
    });
  }

  forgetTab(tabId: number): void {
    this.tabViewer.delete(tabId);
    this.pending.delete(tabId);
    this.sessions.forgetTab(tabId);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((err: unknown) => console.warn('[orbit] capture task failed', err));
    return run.catch(() => undefined);
  }

  private async onViewer(
    tabId: number,
    msg: Extract<RuntimeMessage, { type: 'orbit/viewer' }>,
  ): Promise<void> {
    await recordViewerDetection(this.db, msg.strategy, msg.viewerId !== null, msg.at);
    if (msg.viewerId === null) {
      // Logged out (or detection drifted): no capture at all (§9 Viewer).
      this.forgetTab(tabId);
      return;
    }
    const previous = this.tabViewer.get(tabId);
    if (previous && previous !== msg.viewerId) this.sessions.forgetTab(tabId); // account switch
    this.tabViewer.set(tabId, msg.viewerId);
    const username = UsernameSchema.safeParse(msg.username).success ? msg.username : undefined;
    await new ViewerStore(this.db, msg.viewerId).touchViewer(username, msg.at);

    const waiting = this.pending.get(tabId) ?? [];
    this.pending.delete(tabId);
    for (const m of waiting) {
      if (msg.at - m.at <= PENDING_TTL_MS) await this.process(msg.viewerId, tabId, m);
    }
  }

  private async onResponse(tabId: number, msg: ResponseMessage): Promise<void> {
    // After a service-worker restart the map is empty; the message carries the tab's account.
    if (!this.tabViewer.has(tabId) && msg.viewerId) this.tabViewer.set(tabId, msg.viewerId);
    const viewerId = this.tabViewer.get(tabId);
    if (!viewerId) {
      const list = this.pending.get(tabId) ?? [];
      list.push(msg);
      if (list.length > PENDING_MAX) list.shift();
      this.pending.set(tabId, list);
      return;
    }
    await this.process(viewerId, tabId, msg);
  }

  private async process(viewerId: string, tabId: number, msg: ResponseMessage): Promise<void> {
    const outcome = interpretResponse({ url: msg.url, status: msg.status, text: msg.text });
    await recordOutcome(this.db, outcome, msg.at);
    if (outcome.status !== 'ok') {
      this.onProcessed?.({ viewerId, tabId, outcome });
      return;
    }
    const summary = await applyEvents(outcome.events, {
      store: new ViewerStore(this.db, viewerId),
      at: msg.at,
      tabId,
      sessions: this.sessions,
    });
    this.onProcessed?.({ viewerId, tabId, outcome, summary });
  }
}
