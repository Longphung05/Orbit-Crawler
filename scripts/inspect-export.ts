// Dry-run the export parser on a real Instagram export, locally.
//
//   npm run inspect-export -- "C:\path\to\instagram-you-2026-11-01-xxxx.zip"
//   npm run inspect-export -- "C:\path\to\unzipped-folder"
//
// Prints counts and file statuses only. It never prints usernames, never writes anywhere, and
// makes no network requests.
import { openAsBlob } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import {
  ExportReadError,
  parseExport,
  readExportFolder,
  readExportZip,
  type FolderEntry,
  type ReadResult,
} from '../src/import';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run inspect-export -- <export.zip | export-folder>');
    process.exit(2);
  }

  const info = await stat(target);
  let result: ReadResult;
  const started = performance.now();
  if (info.isDirectory()) {
    const paths = await walk(target);
    const entries: FolderEntry[] = await Promise.all(
      paths.map(async (p) => ({
        path: relative(target, p).split(sep).join('/'),
        blob: await openAsBlob(p),
      })),
    );
    result = await readExportFolder(entries);
  } else {
    let lastPct = -1;
    result = await readExportZip(await openAsBlob(target), ({ bytesRead, totalBytes }) => {
      const pct = Math.floor((bytesRead / totalBytes) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\rReading ${mb(bytesRead)} / ${mb(totalBytes)} (${pct}%)   `);
      }
    });
    process.stdout.write('\n');
  }

  const parsed = parseExport(result.files, { sourceName: basename(target), now: Date.now() });
  const ms = performance.now() - started;

  console.log(
    `\nRead in ${ms.toFixed(0)} ms. Skipped ${result.skipped} unrelated entries (media etc).\n`,
  );
  console.log('Files:');
  for (const f of parsed.files) {
    const n = f.entries === undefined ? '' : ` (${f.entries} entries)`;
    console.log(`  [${f.status.padEnd(12)}] ${f.path}${n}${f.message ? ` — ${f.message}` : ''}`);
  }
  console.log('\nResult:');
  console.log(`  owner username found: ${parsed.ownerUsername ? 'yes' : 'no'}`);
  for (const kind of ['following', 'followers'] as const) {
    const list = parsed[kind];
    console.log(
      `  ${kind.padEnd(9)}: ${list ? `${list.usernames.length} accounts${list.complete ? '' : ' (PARTIAL)'}` : 'not in export'}`,
    );
  }
  console.log(`  pending follow requests: ${parsed.pendingFollowRequests.length}`);
  console.log(
    `  export date: ${new Date(parsed.exportedAt).toISOString()} (from ${parsed.exportedAtSource})`,
  );
  if (parsed.warnings.length) {
    console.log('\nWarnings:');
    for (const w of parsed.warnings) console.log(`  - ${w}`);
  }
  if (parsed.errors.length) {
    console.log('\nErrors (Orbit would refuse this import):');
    for (const e of parsed.errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nLooks importable.');
}

main().catch((err: unknown) => {
  console.error(err instanceof ExportReadError ? `\n${err.message}` : err);
  process.exit(1);
});
