// Official export import (§6.1, §8.3): pick → read (progress) → review report → commit.
// Reading and parsing happen entirely in this extension page; nothing is uploaded anywhere.
import { useEffect, useRef, useState } from 'preact/hooks';
import { recordActivity } from '../../src/capture/activity';
import { getDb } from '../../src/db/db';
import { ViewerStore, type ExportSnapshotResult } from '../../src/db';
import {
  checkOwner,
  commitImport,
  ExportReadError,
  parseExport,
  readExportFolder,
  readExportZip,
  type OwnerCheck,
  type ParsedExport,
  type ReadProgress,
} from '../../src/import';
import { UsernameSchema } from '../../src/db/validation';
import type { ViewerMeta } from '../../src/shared/types';

type State =
  | { step: 'idle' }
  | { step: 'reading'; pct: number }
  | { step: 'review'; parsed: ParsedExport; skipped: number }
  | { step: 'saving' }
  | { step: 'done'; result: ExportSnapshotResult; parsed: ParsedExport; friend?: string }
  | { step: 'error'; message: string };

const SOURCE_LABEL: Record<ParsedExport['exportedAtSource'], string> = {
  'archive-name': 'from the file name',
  'latest-entry': 'from the newest entry',
  'import-time': 'unknown, using today',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function ImportPanel({ viewer }: { viewer: ViewerMeta | null | undefined }) {
  const [state, setState] = useState<State>({ step: 'idle' });
  const [overrideOwner, setOverrideOwner] = useState(false);
  const [whose, setWhose] = useState<'mine' | 'friend'>('mine');
  const [friendName, setFriendName] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInput.current) folderInput.current.webkitdirectory = true;
  }, []);

  const onProgress = ({ bytesRead, totalBytes }: ReadProgress): void => {
    setState({ step: 'reading', pct: totalBytes ? Math.round((bytesRead / totalBytes) * 100) : 0 });
  };

  async function handlePick(list: FileList | null, kind: 'zip' | 'folder'): Promise<void> {
    if (!list || list.length === 0) return;
    setOverrideOwner(false);
    setState({ step: 'reading', pct: 0 });
    try {
      const files = Array.from(list);
      let sourceName: string;
      let read;
      const file = files[0];
      if (kind === 'zip' && file) {
        sourceName = file.name;
        read = await readExportZip(file, onProgress);
      } else {
        sourceName = files[0]?.webkitRelativePath.split('/')[0] ?? '';
        read = await readExportFolder(
          files.map((f) => ({ path: f.webkitRelativePath || f.name, blob: f })),
          onProgress,
        );
      }
      const parsed = parseExport(read.files, { sourceName, now: Date.now() });
      setFriendName(parsed.ownerUsername ?? '');
      setState({ step: 'review', parsed, skipped: read.skipped });
    } catch (err) {
      const message =
        err instanceof ExportReadError ? err.message : 'Something went wrong reading that export.';
      if (!(err instanceof ExportReadError)) console.warn('[orbit] import read failed', err);
      setState({ step: 'error', message });
    }
  }

  async function handleCommit(parsed: ParsedExport): Promise<void> {
    if (!viewer) return;
    const friend = whose === 'friend' ? friendName.trim().replace(/^@/, '') : undefined;
    setState({ step: 'saving' });
    try {
      const store = new ViewerStore(getDb(), viewer.viewerId);
      const result = await commitImport(store, parsed, Date.now(), friend);
      const counts = `${parsed.following?.usernames.length ?? 0} following, ${parsed.followers?.usernames.length ?? 0} followers`;
      await recordActivity(getDb(), viewer.viewerId, Date.now(), [
        {
          kind: 'import',
          text: friend
            ? `Imported @${friend}'s shared export: ${counts}`
            : `Imported your Instagram export: ${counts}`,
        },
      ]);
      // Badges on open instagram.com tabs should pick up the imported connections.
      browser.runtime.sendMessage({ type: 'orbit/graph-changed' }).catch(() => undefined);
      setState({ step: 'done', result, parsed, friend });
    } catch (err) {
      console.warn('[orbit] import commit failed', err);
      setState({ step: 'error', message: 'Saving the import failed. Nothing was changed.' });
    }
  }

  const busy = state.step === 'reading' || state.step === 'saving';

  return (
    <section class="space-y-3 rounded border border-slate-200 p-3">
      <h2 class="font-semibold">Import an Instagram export</h2>
      <div class="flex gap-3 text-xs">
        <label class="flex items-center gap-1">
          <input
            type="radio"
            name="orbit-whose"
            checked={whose === 'mine'}
            disabled={busy}
            onChange={() => setWhose('mine')}
          />
          Mine
        </label>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            name="orbit-whose"
            checked={whose === 'friend'}
            disabled={busy}
            onChange={() => setWhose('friend')}
          />
          A friend's (they shared it with me)
        </label>
      </div>
      {whose === 'friend' && (
        <p class="rounded bg-indigo-50 p-2 text-xs text-indigo-900">
          A friend's export adds who <b>they</b> follow, so Orbit can find 2nd and 3rd-degree links
          without anyone scrolling. Only import an export the friend chose to give you. It stays in
          this browser.
        </p>
      )}
      <p class="text-xs text-slate-600">
        On Instagram: Accounts Center → Your information and permissions → Download your
        information. Choose <b>Followers and following</b> and format <b>JSON</b>. Orbit reads it
        here in your browser; nothing is uploaded.
      </p>

      <div class="flex flex-wrap gap-2">
        <label
          class={`cursor-pointer rounded bg-indigo-600 px-3 py-1.5 text-white ${busy ? 'opacity-50' : 'hover:bg-indigo-700'}`}
        >
          Choose .zip
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            disabled={busy}
            onChange={(e) => void handlePick(e.currentTarget.files, 'zip')}
          />
        </label>
        <label
          class={`cursor-pointer rounded border border-slate-300 px-3 py-1.5 ${busy ? 'opacity-50' : 'hover:bg-slate-50'}`}
        >
          Choose unzipped folder
          <input
            ref={folderInput}
            type="file"
            class="hidden"
            disabled={busy}
            onChange={(e) => void handlePick(e.currentTarget.files, 'folder')}
          />
        </label>
      </div>

      {state.step === 'reading' && (
        <div>
          <div class="h-2 overflow-hidden rounded bg-slate-200">
            <div class="h-full bg-indigo-500 transition-all" style={{ width: `${state.pct}%` }} />
          </div>
          <p class="mt-1 text-xs text-slate-500">Reading… {state.pct}%</p>
        </div>
      )}

      {state.step === 'error' && (
        <p class="rounded bg-red-50 p-2 text-xs text-red-700">{state.message}</p>
      )}

      {state.step === 'review' && (
        <Review
          parsed={state.parsed}
          skipped={state.skipped}
          viewer={viewer}
          whose={whose}
          friendName={friendName}
          setFriendName={setFriendName}
          owner={checkOwner(state.parsed, viewer?.username)}
          overrideOwner={overrideOwner}
          setOverrideOwner={setOverrideOwner}
          onCommit={() => void handleCommit(state.parsed)}
          onCancel={() => setState({ step: 'idle' })}
        />
      )}

      {state.step === 'saving' && <p class="text-xs text-slate-500">Saving…</p>}

      {state.step === 'done' && (
        <div class="rounded bg-emerald-50 p-2 text-xs text-emerald-800">
          <p class="font-medium">
            {state.friend ? `Imported @${state.friend}'s export.` : 'Imported.'}
          </p>
          <p>
            {state.result.added} new connections · {state.result.placeholders} accounts known by
            username only (Orbit links them to real accounts as you browse)
            {state.result.markedStale > 0 && ` · ${state.result.markedStale} no longer current`}
          </p>
        </div>
      )}
    </section>
  );
}

interface ReviewProps {
  parsed: ParsedExport;
  skipped: number;
  viewer: ViewerMeta | null | undefined;
  whose: 'mine' | 'friend';
  friendName: string;
  setFriendName: (v: string) => void;
  owner: OwnerCheck;
  overrideOwner: boolean;
  setOverrideOwner: (v: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function Review({
  parsed,
  skipped,
  viewer,
  whose,
  friendName,
  setFriendName,
  owner,
  overrideOwner,
  setOverrideOwner,
  onCommit,
  onCancel,
}: ReviewProps) {
  const listLine = (label: string, list: ParsedExport['following']) =>
    list
      ? `${list.usernames.length.toLocaleString()} ${label}${list.complete ? '' : ' (partial)'}`
      : `no ${label} file`;
  const friend = friendName.trim().replace(/^@/, '');
  const friendValid = UsernameSchema.safeParse(friend).success;
  const friendIsYou = !!viewer?.username && friend.toLowerCase() === viewer.username.toLowerCase();
  const blocked =
    whose === 'mine' ? owner === 'mismatch' && !overrideOwner : !friendValid || friendIsYou;
  const canCommit = parsed.errors.length === 0 && !!viewer && !blocked;
  const unrecognized = parsed.files.filter(
    (f) => f.status === 'unrecognized' || f.status === 'failed',
  );

  return (
    <div class="space-y-2 text-xs">
      <ul class="space-y-0.5">
        <li>{listLine('following', parsed.following)}</li>
        <li>{listLine('followers', parsed.followers)}</li>
        {parsed.pendingFollowRequests.length > 0 && (
          <li>
            {parsed.pendingFollowRequests.length} pending follow requests (not counted as following)
          </li>
        )}
        <li>
          Export date: {formatDate(parsed.exportedAt)} ({SOURCE_LABEL[parsed.exportedAtSource]})
        </li>
        <li class="text-slate-500">{skipped} unrelated files skipped</li>
      </ul>

      {parsed.errors.map((e) => (
        <p key={e} class="rounded bg-red-50 p-2 text-red-700">
          {e}
        </p>
      ))}
      {parsed.warnings.map((w) => (
        <p key={w} class="rounded bg-amber-50 p-2 text-amber-800">
          {w}
        </p>
      ))}

      {unrecognized.length > 0 && (
        <details>
          <summary class="cursor-pointer text-slate-600">
            {unrecognized.length} file(s) Orbit didn't use
          </summary>
          <ul class="mt-1 space-y-0.5 text-slate-500">
            {unrecognized.map((f) => (
              <li key={f.path}>
                {f.path.split('/').slice(-2).join('/')}: {f.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!viewer && parsed.errors.length === 0 && (
        <p class="rounded bg-slate-100 p-2 text-slate-700">
          The export looks good. To save it, open instagram.com in this browser while logged in so
          Orbit can tell which account it belongs to, then come back here.
        </p>
      )}

      {whose === 'friend' && (
        <div class="space-y-1">
          <label class="flex items-center gap-1">
            Friend's username: @
            <input
              class="rounded border border-slate-300 px-1 py-0.5"
              value={friendName}
              onInput={(e) => setFriendName(e.currentTarget.value)}
            />
          </label>
          {friendIsYou && (
            <p class="rounded bg-red-50 p-2 text-red-700">
              That's your own account. Choose "Mine" above instead.
            </p>
          )}
          {!friendValid && friend !== '' && (
            <p class="text-red-700">That doesn't look like an Instagram username.</p>
          )}
        </div>
      )}

      {whose === 'mine' && owner === 'mismatch' && viewer && (
        <div class="rounded bg-red-50 p-2 text-red-700">
          <p>
            This export belongs to @{parsed.ownerUsername}, but you're logged in as @
            {viewer.username}. Importing it would mix two accounts' data.
          </p>
          <label class="mt-1 flex items-center gap-1">
            <input
              type="checkbox"
              checked={overrideOwner}
              onChange={(e) => setOverrideOwner(e.currentTarget.checked)}
            />
            It's mine; I changed my username since the export
          </label>
        </div>
      )}

      <div class="flex gap-2">
        <button
          type="button"
          disabled={!canCommit}
          class="rounded bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-40"
          onClick={onCommit}
        >
          {whose === 'friend'
            ? `Import @${friend || '…'}'s connections`
            : viewer?.username
              ? `Import into @${viewer.username}`
              : viewer
                ? 'Import into your account'
                : 'Import'}
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 px-3 py-1.5"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
