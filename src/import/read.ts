// Read an export zip or unzipped folder without loading media into memory (§9: large exports).
// Works in the extension (Blob/File) and in Node (fs.openAsBlob) alike. No network access.
import { Unzip, UnzipInflate, unzip as unzipAll } from 'fflate';
import { isRelevantPath, type ExportFile } from './parse';

export interface ReadProgress {
  bytesRead: number;
  totalBytes: number;
}

export interface ReadResult {
  files: ExportFile[];
  /** Entries skipped without decompressing (photos, videos, unrelated data). */
  skipped: number;
}

/** No single relevant JSON file should be anywhere near this; it guards against zip bombs. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
/** Fallback (non-streaming) unzip is only attempted for archives up to this size. */
const MAX_FALLBACK_ARCHIVE_BYTES = 512 * 1024 * 1024;

const decoder = new TextDecoder('utf-8');

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/');
}

export class ExportReadError extends Error {}

async function streamUnzip(
  blob: Blob,
  onProgress?: (p: ReadProgress) => void,
): Promise<ReadResult> {
  const files: ExportFile[] = [];
  const pending: Promise<void>[] = [];
  let skipped = 0;
  let failure: unknown;

  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (entry) => {
    const path = normalise(entry.name);
    if (!isRelevantPath(path)) {
      skipped++;
      return; // not started → its bytes are discarded without inflating
    }
    if ((entry.originalSize ?? 0) > MAX_ENTRY_BYTES) {
      skipped++;
      return;
    }
    pending.push(
      new Promise<void>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        entry.ondata = (err, data, final) => {
          if (err) {
            reject(err);
            return;
          }
          total += data.length;
          if (total > MAX_ENTRY_BYTES) {
            entry.terminate();
            reject(new ExportReadError(`${path} is unexpectedly large`));
            return;
          }
          chunks.push(data);
          if (final) {
            files.push({ path, text: decoder.decode(concat(chunks, total)) });
            resolve();
          }
        };
        entry.start();
      }).catch((err: unknown) => {
        failure ??= err;
      }),
    );
  };

  const reader = blob.stream().getReader();
  let bytesRead = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.length;
    uz.push(value, false);
    onProgress?.({ bytesRead, totalBytes: blob.size });
    // Yield so the UI can paint progress on big archives.
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  uz.push(new Uint8Array(0), true);
  await Promise.all(pending);
  if (failure) throw failure;
  return { files, skipped };
}

function fallbackUnzip(bytes: Uint8Array): Promise<ReadResult> {
  let skipped = 0;
  return new Promise((resolve, reject) => {
    unzipAll(
      bytes,
      {
        filter: (f) => {
          const keep = isRelevantPath(normalise(f.name)) && f.originalSize <= MAX_ENTRY_BYTES;
          if (!keep) skipped++;
          return keep;
        },
      },
      (err, out) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          files: Object.entries(out).map(([name, data]) => ({
            path: normalise(name),
            text: decoder.decode(data),
          })),
          skipped,
        });
      },
    );
  });
}

async function isZip(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * A complete zip ends with an End Of Central Directory record (signature PK\x05\x06) within the
 * last 22 + 65535 bytes. A truncated download lacks it, and streaming would otherwise quietly
 * return only the entries that happened to arrive, turning a cut-off list into a "complete" one.
 */
async function hasEndOfCentralDirectory(blob: Blob): Promise<boolean> {
  const tailSize = Math.min(blob.size, 22 + 0xffff);
  const tail = new Uint8Array(await blob.slice(blob.size - tailSize).arrayBuffer());
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

/** Read the relevant JSON files out of an Instagram export zip. */
export async function readExportZip(
  blob: Blob,
  onProgress?: (p: ReadProgress) => void,
): Promise<ReadResult> {
  if (!(await isZip(blob))) {
    throw new ExportReadError(
      'That file is not a zip archive. Choose the .zip Instagram sent you.',
    );
  }
  if (!(await hasEndOfCentralDirectory(blob))) {
    throw new ExportReadError(
      'This zip looks incomplete (the download may have been cut off). Download it again.',
    );
  }
  try {
    const result = await streamUnzip(blob, onProgress);
    if (result.files.length > 0) return result;
  } catch (err) {
    if (err instanceof ExportReadError) throw err;
    // Some zip writers use layouts the streaming reader can't follow; retry whole-file below.
  }
  if (blob.size > MAX_FALLBACK_ARCHIVE_BYTES) {
    throw new ExportReadError(
      "Couldn't read this archive. Unzip it and choose the folder instead.",
    );
  }
  try {
    const result = await fallbackUnzip(new Uint8Array(await blob.arrayBuffer()));
    onProgress?.({ bytesRead: blob.size, totalBytes: blob.size });
    return result;
  } catch {
    throw new ExportReadError('This zip archive appears to be damaged.');
  }
}

/** A file from an `<input webkitdirectory>` pick (or any path + Blob pair). */
export interface FolderEntry {
  path: string;
  blob: Blob;
}

/** Read the relevant JSON files out of an unzipped export folder. */
export async function readExportFolder(
  entries: readonly FolderEntry[],
  onProgress?: (p: ReadProgress) => void,
): Promise<ReadResult> {
  const relevant = entries.filter((e) => isRelevantPath(normalise(e.path)));
  const totalBytes = relevant.reduce((n, e) => n + e.blob.size, 0);
  const files: ExportFile[] = [];
  let bytesRead = 0;
  for (const e of relevant) {
    if (e.blob.size > MAX_ENTRY_BYTES) continue;
    files.push({ path: normalise(e.path), text: await e.blob.text() });
    bytesRead += e.blob.size;
    onProgress?.({ bytesRead, totalBytes });
  }
  return { files, skipped: entries.length - relevant.length };
}
