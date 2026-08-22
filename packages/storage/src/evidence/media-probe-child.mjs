import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import mediaInfoFactory from "mediainfo.js";

import { capWasmMemory, inspectWasmMemory } from "./wasm-memory-cap.mjs";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAXIMUM_WASM_PAGES = 2048;
const MEDIA_PROBE_PREFIX = "oh-my-bug-media-probe-";
const MEDIA_PROBE_OWNER = ".oh-my-bug-owner.json";
const execute = promisify(execFile);

const originalWasmPath = fileURLToPath(import.meta.resolve("mediainfo.js/MediaInfoModule.wasm"));
const originalWasm = await readFile(originalWasmPath);
const cappedWasm = capWasmMemory(originalWasm, MAXIMUM_WASM_PAGES);
const originalMemory = inspectWasmMemory(originalWasm);
const memory = inspectWasmMemory(cappedWasm);

if (process.env.OH_MY_BUG_MEDIA_PROBE_SELF_TEST === "1") {
  const module = await WebAssembly.compile(cappedWasm);
  const imports = WebAssembly.Module.imports(module).reduce((result, entry) => {
    result[entry.module] ??= {};
    result[entry.module][entry.name] = () => 0;
    return result;
  }, {});
  const instance = await WebAssembly.instantiate(module, imports);
  let growthBeyondLimitRejected = false;
  try {
    instance.exports.m.grow(MAXIMUM_WASM_PAGES);
  } catch (error) {
    growthBeyondLimitRejected = error instanceof RangeError;
  }
  process.stdout.write(JSON.stringify({
    originalMemoryMaximumPages: originalMemory.maximumPages,
    memoryMinimumPages: memory.minimumPages,
    memoryMaximumPages: memory.maximumPages,
    memoryMaximumBytes: memory.maximumBytes,
    growthBeyondLimitRejected
  }));
} else {
  const temporary = process.env.OH_MY_BUG_MEDIA_PROBE_TEMP_DIR;
  try {
    await analyzeInput(cappedWasm, memory, temporary);
  } finally {
    await cleanupOwnedTemporary(temporary);
  }
}

async function analyzeInput(wasm, memoryLimits, temporary) {
  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += chunk.byteLength;
    if (inputBytes > MAX_INPUT_BYTES) throw new Error("MEDIA_PROBE_INPUT_LIMIT");
    chunks.push(chunk);
  }

  const content = Buffer.concat(chunks, inputBytes);
  const mimeType = process.env.OH_MY_BUG_MEDIA_PROBE_MIME;
  if (!temporary || !isAbsolute(temporary)) throw new Error("MEDIA_PROBE_TEMP_INVALID");
  if (mimeType !== "video/mp4" && mimeType !== "video/webm") throw new Error("MEDIA_PROBE_MIME_INVALID");
  const wasmPath = join(temporary, "MediaInfoModule.wasm");
  let mediaInfo;
  let result;
  try {
    await writeFile(wasmPath, wasm, { mode: 0o600 });
    mediaInfo = await mediaInfoFactory({
      chunkSize: 64 * 1024,
      locateFile: () => wasmPath
    });
    result = await mediaInfo.analyzeData(
      content.byteLength,
      (size, offset) => content.subarray(offset, offset + size)
    );
  } finally {
    mediaInfo?.close();
  }
  const tracks = result.media?.track ?? [];
  const general = tracks.find((track) => track["@type"] === "General");
  const video = tracks.find((track) => track["@type"] === "Video");
  const expectedContainer = mimeType === "video/mp4" ? "MPEG-4" : "WebM";
  const isTruncated = tracks.some((track) => isAffirmative(track.extra?.IsTruncated));
  const hasConformanceErrors = tracks.some((track) => hasValue(track.extra?.ConformanceErrors));
  if (
    general?.Format !== expectedContainer ||
    !video?.Format ||
    !Number.isFinite(video.Width) || video.Width <= 0 || video.Width > 8192 ||
    !Number.isFinite(video.Height) || video.Height <= 0 || video.Height > 8192 ||
    video.Width * video.Height > 20_000_000 ||
    isTruncated ||
    hasConformanceErrors
  ) {
    throw new Error("MEDIA_PROBE_METADATA_INVALID");
  }
  const decoded = await decodeFirstFrame(content, mimeType, temporary);
  process.stdout.write(JSON.stringify({
    libraryName: result.creatingLibrary?.name,
    libraryVersion: result.creatingLibrary?.version,
    container: general.Format,
    videoFormat: video.Format,
    width: video.Width,
    height: video.Height,
    frameCount: video.FrameCount,
    videoStreamSize: video.StreamSize,
    isTruncated,
    hasConformanceErrors,
    memoryMaximumPages: memoryLimits.maximumPages,
    decodedFrame: decoded
  }));
}

async function decodeFirstFrame(content, mimeType, temporary) {
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(join(temporary, "browser-profile"), {
    headless: true,
    chromiumSandbox: true,
    offline: true,
    serviceWorkers: "block"
  });
  try {
    if (process.env.OH_MY_BUG_MEDIA_PROBE_STALL_AFTER_BROWSER_LAUNCH === "1") {
      const descendants = await descendantProcessIds(process.pid);
      process.stderr.write(`BROWSER_STARTED:${[process.pid, ...descendants].join(",")}\n`);
      await new Promise(() => undefined);
    }
    const page = context.pages()[0] ?? await context.newPage();
    const result = await page.evaluate(async ({ base64, declaredMimeType }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      const source = URL.createObjectURL(new Blob([bytes], { type: declaredMimeType }));
      video.src = source;
      try {
        return await new Promise((resolvePromise) => {
          const timeout = setTimeout(
            () => resolvePromise({ decoded: false, width: 0, height: 0 }),
            5_000
          );
          video.addEventListener("loadeddata", () => {
            clearTimeout(timeout);
            resolvePromise({ decoded: true, width: video.videoWidth, height: video.videoHeight });
          }, { once: true });
          video.addEventListener("error", () => {
            clearTimeout(timeout);
            resolvePromise({ decoded: false, width: 0, height: 0 });
          }, { once: true });
          video.load();
        });
      } finally {
        URL.revokeObjectURL(source);
      }
    }, { base64: content.toString("base64"), declaredMimeType: mimeType });
    return result.decoded === true && result.width > 0 && result.height > 0;
  } finally {
    await context.close();
  }
}

async function cleanupOwnedTemporary(temporary) {
  if (!temporary || !isAbsolute(temporary) || !basename(temporary).startsWith(MEDIA_PROBE_PREFIX)) return;
  try {
    const owner = JSON.parse(await readFile(join(temporary, MEDIA_PROBE_OWNER), "utf8"));
    if (owner.version !== 1 || !Number.isSafeInteger(owner.parentPid) || owner.parentPid <= 0) return;
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // The parent owns the same cleanup and may already have removed the directory.
  }
}

async function descendantProcessIds(rootPid) {
  if (process.platform === "win32") return [];
  try {
    const { stdout } = await execute("ps", ["-ax", "-o", "pid=,ppid="]);
    const children = new Map();
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
      if (!match) continue;
      const pid = Number(match[1]);
      const parentPid = Number(match[2]);
      const siblings = children.get(parentPid) ?? [];
      siblings.push(pid);
      children.set(parentPid, siblings);
    }
    const descendants = [];
    const pending = [...(children.get(rootPid) ?? [])];
    while (pending.length > 0) {
      const pid = pending.pop();
      descendants.push(pid);
      pending.push(...(children.get(pid) ?? []));
    }
    return descendants;
  } catch {
    return [];
  }
}

function isAffirmative(value) {
  return value === true || (typeof value === "string" && ["yes", "true", "1"].includes(value.toLowerCase()));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}
