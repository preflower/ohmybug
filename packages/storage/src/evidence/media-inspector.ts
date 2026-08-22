import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MEDIA_PROBE_PREFIX = "oh-my-bug-media-probe-";
const MEDIA_PROBE_OWNER = ".oh-my-bug-owner.json";

interface VideoProbeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  stallAfterBrowserLaunch?: boolean;
}

export async function assertMediaContent(content: Buffer, mimeType: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (mimeType.startsWith("image/")) {
    const expectedFormat = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[mimeType];
    if (!expectedFormat) throw new Error("EVIDENCE_CONTENT_TYPE_INVALID");
    try {
      const image = sharp(content, { failOn: "error", limitInputPixels: 20_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
        throw new Error("EVIDENCE_CONTENT_TYPE_INVALID");
      }
      await image.raw().toBuffer();
    } catch (error) {
      if (error instanceof Error && error.message === "EVIDENCE_CONTENT_TYPE_INVALID") throw error;
      throw new Error("EVIDENCE_CONTENT_TYPE_INVALID", { cause: error });
    }
    return;
  }
  if (mimeType === "video/mp4" || mimeType === "video/webm") {
    await assertVideoContent(content, mimeType, signal);
    return;
  }
  throw new Error("EVIDENCE_CONTENT_TYPE_INVALID");
}

async function assertVideoContent(
  content: Buffer,
  mimeType: "video/mp4" | "video/webm",
  signal?: AbortSignal
): Promise<void> {
  const hasCompletePayload = mimeType === "video/mp4"
    ? hasCompleteMp4Payload(content)
    : hasCompleteWebmPayload(content);
  if (!hasCompletePayload) throw new Error("EVIDENCE_CONTENT_TYPE_INVALID");
  const output = await probeVideo(content, mimeType, { signal });
  const parsed = JSON.parse(output) as {
    libraryName?: string;
    libraryVersion?: string;
    container?: string;
    videoFormat?: string;
    width?: number;
    height?: number;
    frameCount?: number;
    videoStreamSize?: number;
    isTruncated?: boolean;
    hasConformanceErrors?: boolean;
    memoryMaximumPages?: number;
    decodedFrame?: boolean;
  };
  const expectedContainer = mimeType === "video/mp4" ? "MPEG-4" : "WebM";
  if (
    parsed.libraryName !== "MediaInfoLib" ||
    !supportedMediaInfoVersion(parsed.libraryVersion) ||
    parsed.container !== expectedContainer ||
    !parsed.videoFormat ||
    !Number.isFinite(parsed.width) || parsed.width! <= 0 ||
    !Number.isFinite(parsed.height) || parsed.height! <= 0 ||
    (!Number.isFinite(parsed.frameCount) || parsed.frameCount! <= 0) &&
      (!Number.isFinite(parsed.videoStreamSize) || parsed.videoStreamSize! <= 0) ||
    parsed.isTruncated !== false ||
    parsed.hasConformanceErrors !== false ||
    parsed.memoryMaximumPages !== 2048 ||
    parsed.decodedFrame !== true
  ) {
    throw new Error("EVIDENCE_CONTENT_TYPE_INVALID");
  }
}

function hasCompleteMp4Payload(content: Buffer): boolean {
  let offset = 0;
  let hasFileType = false;
  let hasMovie = false;
  let mediaPayloadBytes = 0;
  while (offset < content.byteLength) {
    if (content.byteLength - offset < 8) return false;
    const declaredSize = content.readUInt32BE(offset);
    const type = content.toString("latin1", offset + 4, offset + 8);
    let headerBytes = 8;
    let boxBytes: number;
    if (declaredSize === 1) {
      if (content.byteLength - offset < 16) return false;
      const extendedSize = content.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      headerBytes = 16;
      boxBytes = Number(extendedSize);
    } else {
      boxBytes = declaredSize === 0 ? content.byteLength - offset : declaredSize;
    }
    if (boxBytes < headerBytes || offset + boxBytes > content.byteLength) return false;
    if (type === "ftyp") hasFileType = true;
    if (type === "moov") hasMovie = true;
    if (type === "mdat") mediaPayloadBytes += boxBytes - headerBytes;
    offset += boxBytes;
    if (declaredSize === 0 && offset !== content.byteLength) return false;
  }
  return offset === content.byteLength && hasFileType && hasMovie && mediaPayloadBytes > 0;
}

interface EbmlElement {
  id: number;
  dataStart: number;
  end: number;
  unknownSize: boolean;
}

function hasCompleteWebmPayload(content: Buffer): boolean {
  let offset = 0;
  let hasHeader = false;
  let hasSegment = false;
  let hasPayload = false;
  while (offset < content.byteLength) {
    const element = readEbmlElement(content, offset, content.byteLength);
    if (!element || (element.unknownSize && element.id !== 0x18538067)) return false;
    if (element.id === 0x1a45dfa3) {
      if (element.unknownSize) return false;
      hasHeader = true;
    }
    if (element.id === 0x18538067) {
      hasSegment = true;
      hasPayload ||= segmentHasMediaPayload(content, element.dataStart, element.end);
    }
    if (element.end <= offset) return false;
    offset = element.end;
  }
  return offset === content.byteLength && hasHeader && hasSegment && hasPayload;
}

function segmentHasMediaPayload(content: Buffer, start: number, end: number): boolean {
  let offset = start;
  let hasPayload = false;
  while (offset < end) {
    const element = readEbmlElement(content, offset, end);
    if (!element || (element.unknownSize && element.id !== 0x1f43b675)) return false;
    if (element.id === 0x1f43b675) {
      hasPayload ||= clusterHasMediaPayload(content, element.dataStart, element.end);
    }
    if (element.end <= offset) return false;
    offset = element.end;
  }
  return offset === end && hasPayload;
}

function clusterHasMediaPayload(content: Buffer, start: number, end: number): boolean {
  let offset = start;
  let hasPayload = false;
  while (offset < end) {
    const element = readEbmlElement(content, offset, end);
    if (!element || element.unknownSize) return false;
    if (element.id === 0xa3) hasPayload ||= blockHasFrameData(content, element.dataStart, element.end);
    if (element.id === 0xa0) hasPayload ||= blockGroupHasFrameData(content, element.dataStart, element.end);
    if (element.end <= offset) return false;
    offset = element.end;
  }
  return offset === end && hasPayload;
}

function blockGroupHasFrameData(content: Buffer, start: number, end: number): boolean {
  let offset = start;
  while (offset < end) {
    const element = readEbmlElement(content, offset, end);
    if (!element || element.unknownSize) return false;
    if (element.id === 0xa1 && blockHasFrameData(content, element.dataStart, element.end)) return true;
    if (element.end <= offset) return false;
    offset = element.end;
  }
  return false;
}

function blockHasFrameData(content: Buffer, start: number, end: number): boolean {
  const trackNumber = readEbmlVint(content, start, end, false, 8);
  return Boolean(trackNumber && end - trackNumber.next >= 4);
}

function readEbmlElement(content: Buffer, offset: number, limit: number): EbmlElement | undefined {
  const id = readEbmlVint(content, offset, limit, true, 4);
  if (!id) return undefined;
  const size = readEbmlVint(content, id.next, limit, false, 8);
  if (!size) return undefined;
  const dataStart = size.next;
  if (size.unknown) return { id: id.value, dataStart, end: limit, unknownSize: true };
  if (!Number.isSafeInteger(size.value) || dataStart + size.value > limit) return undefined;
  return { id: id.value, dataStart, end: dataStart + size.value, unknownSize: false };
}

function readEbmlVint(
  content: Buffer,
  offset: number,
  limit: number,
  retainMarker: boolean,
  maximumBytes: number
): { value: number; next: number; unknown: boolean } | undefined {
  if (offset >= limit) return undefined;
  const first = content[offset]!;
  let length = 1;
  let marker = 0x80;
  while (length <= maximumBytes && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > maximumBytes || offset + length > limit) return undefined;
  let value = retainMarker ? first : first & (marker - 1);
  let unknown = !retainMarker && (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index += 1) {
    const byte = content[offset + index]!;
    value = value * 256 + byte;
    unknown &&= byte === 0xff;
  }
  return { value, next: offset + length, unknown };
}

function supportedMediaInfoVersion(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 25 || (major === 25 && minor >= 10);
}

export async function probeVideo(
  content: Buffer,
  mimeType: "video/mp4" | "video/webm",
  options: VideoProbeOptions = {}
): Promise<string> {
  const { timeoutMs = 20_000, signal, stallAfterBrowserLaunch = false } = options;
  signal?.throwIfAborted();
  await recoverStaleMediaProbeDirectories();
  const temporary = await mkdtemp(join(tmpdir(), MEDIA_PROBE_PREFIX));
  try {
    await writeFile(join(temporary, MEDIA_PROBE_OWNER), JSON.stringify({
      version: 1,
      parentPid: process.pid,
      createdAt: new Date().toISOString()
    }), { flag: "wx", mode: 0o600 });
    signal?.throwIfAborted();
    return await new Promise((resolvePromise, rejectPromise) => {
      const probeScript = fileURLToPath(new URL("./media-probe-child.mjs", import.meta.url));
      const child = spawn(process.execPath, ["--max-old-space-size=128", probeScript], {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: {
          ...sanitizedProbeEnvironment(),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          OH_MY_BUG_MEDIA_PROBE_MIME: mimeType,
          OH_MY_BUG_MEDIA_PROBE_TEMP_DIR: temporary,
          ...(stallAfterBrowserLaunch
            ? { OH_MY_BUG_MEDIA_PROBE_STALL_AFTER_BROWSER_LAUNCH: "1" }
            : {})
        }
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let failure: Error | undefined;
      let termination: Promise<void> | undefined;
      const fail = (error: Error) => {
        failure ??= error;
        termination ??= terminateProbeProcess(child);
      };
      const timeout = setTimeout(() => {
        const browser = /BROWSER_STARTED:([\d,]+)/.exec(Buffer.concat(stderr).toString("utf8"));
        const state = browser ? `:BROWSER_STARTED:${browser[1]}` : "";
        fail(new Error(`EVIDENCE_VIDEO_PROBE_TIMEOUT${state}`));
      }, timeoutMs);
      const onAbort = () => fail(new Error("RUN_CANCELED", { cause: signal?.reason }));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > 1024 * 1024) {
          fail(new Error("EVIDENCE_VIDEO_PROBE_OUTPUT_LIMIT"));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.stdin.on("error", (error) => fail(error));
      child.on("error", (error) => fail(error));
      child.on("close", async (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        await termination;
        if (failure) {
          rejectPromise(failure);
          return;
        }
        if (code !== 0) {
          rejectPromise(new Error(`EVIDENCE_VIDEO_INVALID:${Buffer.concat(stderr).toString("utf8").trim()}`));
          return;
        }
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
      });
      child.stdin.end(content);
    });
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function terminateProbeProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePromise();
      };
      const timeout = setTimeout(() => {
        killer.kill("SIGKILL");
        finish();
      }, 5_000);
      killer.once("error", finish);
      killer.once("close", finish);
    });
    try {
      child.kill("SIGKILL");
    } catch {
      // taskkill already removed the complete process tree.
    }
    return;
  }
  try {
    if (child.pid) {
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process has already exited.
    }
  }
}

export async function recoverStaleMediaProbeDirectories(): Promise<void> {
  const root = tmpdir();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(MEDIA_PROBE_PREFIX))
    .map(async (entry) => {
      const directory = join(root, entry.name);
      try {
        const owner = JSON.parse(await readFile(join(directory, MEDIA_PROBE_OWNER), "utf8")) as {
          version?: number;
          parentPid?: number;
        };
        if (
          owner.version !== 1 ||
          !Number.isSafeInteger(owner.parentPid) ||
          owner.parentPid! <= 0 ||
          processIsAlive(owner.parentPid!)
        ) return;
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Unknown directories are never treated as ours.
      }
    }));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function sanitizedProbeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      name !== "NODE_OPTIONS" &&
      name !== "NODE_PATH" &&
      !name.startsWith("OH_MY_BUG_MEDIA_PROBE_")
    )
  );
}

export async function readBounded(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  if (maxBytes < 0) throw new Error("EVIDENCE_SIZE_OR_TYPE_INVALID");
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  while (true) {
    const remainingProbe = maxBytes + 1 - total;
    if (remainingProbe <= 0) throw new Error("EVIDENCE_SIZE_OR_TYPE_INVALID");
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingProbe));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
    if (bytesRead === 0) break;
    total += bytesRead;
    position += bytesRead;
    if (total > maxBytes) throw new Error("EVIDENCE_SIZE_OR_TYPE_INVALID");
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}
