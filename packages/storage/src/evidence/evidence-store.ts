import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdtemp,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";

import type {
  EvidenceImport,
  EvidenceInspection,
  EvidenceInspector,
  EvidenceStore,
  VisualEvidence,
} from "@oh-my-bug/core";

import { writeFileAtomic } from "./atomic-write.js";
import { assertMediaContent, readBounded } from "./media-inspector.js";

interface StoredEvidence {
  evidenceId: string;
  issueId: string;
  repairIteration: number;
  type: VisualEvidence["type"];
  label: string;
  mimeType: string;
  path: string;
}

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const INTAKE_OWNER = ".oh-my-bug-evidence-intake.json";
const INTAKE_PREFIX = ".oh-my-bug-tmp-evidence-";
const mimeTypes: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const extensions: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

export class LocalEvidenceStore implements EvidenceStore, EvidenceInspector {
  constructor(private readonly root: string) {}

  async prepareIntake(
    issueId: string,
    repairIteration: number,
    workspaceDirectory: string,
  ) {
    validateScope(issueId, repairIteration);
    const canonicalWorkspace = await realpath(workspaceDirectory).catch((error: unknown) => {
      throw new Error("EVIDENCE_WORKSPACE_INVALID", { cause: error });
    });
    const workspaceInfo = await lstat(canonicalWorkspace).catch((error: unknown) => {
      throw new Error("EVIDENCE_WORKSPACE_INVALID", { cause: error });
    });
    if (!workspaceInfo.isDirectory()) throw new Error("EVIDENCE_WORKSPACE_INVALID");
    const directory = await mkdtemp(join(canonicalWorkspace, INTAKE_PREFIX));
    await writeFile(
      join(directory, INTAKE_OWNER),
      JSON.stringify({ issueId, repairIteration }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    let cleaned = false;
    return {
      directory,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await rm(directory, { recursive: true, force: true });
      },
    };
  }

  async import(input: EvidenceImport): Promise<VisualEvidence> {
    validateScope(input.issueId, input.repairIteration);
    if (!input.label.trim()) throw new Error("INVALID_EVIDENCE_LABEL");
    const sourcePath = await this.resolveIntakeSource(input);
    const mimeType = mimeTypes[extname(sourcePath).toLowerCase()];
    const expectedPrefix = input.type === "screenshot" ? "image/" : "video/";
    if (!mimeType?.startsWith(expectedPrefix)) throw new Error("UNSUPPORTED_VISUAL_EVIDENCE");

    let handle;
    try {
      handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(
        error instanceof Error && "code" in error && error.code === "ELOOP"
          ? "EVIDENCE_PATH_ESCAPE"
          : "VISUAL_EVIDENCE_UNREADABLE",
        { cause: error },
      );
    }
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > MAX_EVIDENCE_BYTES) {
        throw new Error("VISUAL_EVIDENCE_SIZE_INVALID");
      }
      bytes = await readBounded(handle, MAX_EVIDENCE_BYTES);
    } finally {
      await handle.close();
    }
    await assertMediaContent(bytes, mimeType);

    const evidenceId = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
    const path = join(
      "issues",
      input.issueId,
      "repairs",
      String(input.repairIteration),
      "evidence",
      `${evidenceId}${canonicalExtension(mimeType)}`,
    );
    const stored: StoredEvidence = {
      evidenceId,
      issueId: input.issueId,
      repairIteration: input.repairIteration,
      type: input.type,
      label: input.label,
      mimeType,
      path,
    };
    const evidenceDirectory = dirname(join(this.root, path));
    await writeFileAtomic(join(this.root, path), bytes);
    await writeFileAtomic(join(evidenceDirectory, `${evidenceId}.json`), JSON.stringify(stored));
    return { type: input.type, label: input.label, evidenceId };
  }

  async read(issueId: string, evidenceId: string): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    label: string;
  }> {
    const descriptor = await this.readDescriptor(issueId, evidenceId);
    const bytes = await this.readStoredBytes(descriptor);
    return { bytes, mimeType: descriptor.mimeType, label: descriptor.label };
  }

  private async readStoredBytes(descriptor: StoredEvidence): Promise<Buffer> {
    const path = safeChild(this.root, descriptor.path, "EVIDENCE_PATH_ESCAPE");
    const canonicalRoot = await realpath(this.root);
    const canonical = await realpath(path).catch((error: unknown) => {
      throw new Error("EVIDENCE_NOT_FOUND", { cause: error });
    });
    const storedInfo = await lstat(path).catch((error: unknown) => {
      throw new Error("EVIDENCE_NOT_FOUND", { cause: error });
    });
    if (!within(canonicalRoot, canonical) || storedInfo.isSymbolicLink()) {
      throw new Error("EVIDENCE_PATH_ESCAPE");
    }
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(
        error instanceof Error && "code" in error && error.code === "ELOOP"
          ? "EVIDENCE_PATH_ESCAPE"
          : "EVIDENCE_NOT_FOUND",
        { cause: error },
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readBounded(handle, MAX_EVIDENCE_BYTES);
    } finally {
      await handle.close();
    }
    const actualId = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
    if (actualId !== descriptor.evidenceId) throw new Error("EVIDENCE_INTEGRITY_ERROR");
    return bytes;
  }

  async inspect(
    issueId: string,
    repairIteration: number,
    evidenceId: string,
  ): Promise<EvidenceInspection> {
    let descriptor: StoredEvidence;
    try {
      descriptor = await this.readDescriptor(issueId, evidenceId, repairIteration);
    } catch {
      return missingInspection(evidenceId, repairIteration);
    }
    let bytes: Buffer;
    try {
      bytes = await this.readStoredBytes(descriptor);
    } catch {
      return {
        ...missingInspection(evidenceId, descriptor.repairIteration),
        mediaKind: descriptor.type === "screenshot" ? "image" : "video",
      };
    }
    const mediaKind = descriptor.type === "screenshot" ? "image" : "video";
    try {
      await assertMediaContent(bytes, descriptor.mimeType);
      return {
        evidenceId,
        repairIteration: descriptor.repairIteration,
        exists: true,
        byteLength: bytes.byteLength,
        mediaKind,
        decodes: mediaKind === "image",
        playable: mediaKind === "video",
        hasMediaPayload: mediaKind === "video",
      };
    } catch {
      return {
        evidenceId,
        repairIteration: descriptor.repairIteration,
        exists: true,
        byteLength: bytes.byteLength,
        mediaKind,
        decodes: false,
        playable: false,
        hasMediaPayload: false,
      };
    }
  }

  private async resolveIntakeSource(input: EvidenceImport): Promise<string> {
    if (!input.relativePath || isAbsolute(input.relativePath)) throw new Error("EVIDENCE_PATH_ESCAPE");
    const [canonicalWorkspace, canonicalIntake, intakeInfo] = await Promise.all([
      realpath(input.workspaceDirectory),
      realpath(input.intakeDirectory),
      lstat(input.intakeDirectory),
    ]).catch((error: unknown) => {
      throw new Error("EVIDENCE_INTAKE_INVALID", { cause: error });
    });
    if (
      dirname(canonicalIntake) !== canonicalWorkspace ||
      !basename(canonicalIntake).startsWith(INTAKE_PREFIX) ||
      !intakeInfo.isDirectory() ||
      intakeInfo.isSymbolicLink()
    ) {
      throw new Error("EVIDENCE_INTAKE_INVALID");
    }
    const marker = await readFile(join(canonicalIntake, INTAKE_OWNER), "utf8").catch((error: unknown) => {
      throw new Error("EVIDENCE_INTAKE_INVALID", { cause: error });
    });
    if (marker !== JSON.stringify({ issueId: input.issueId, repairIteration: input.repairIteration })) {
      throw new Error("EVIDENCE_INTAKE_INVALID");
    }
    const source = resolve(canonicalIntake, input.relativePath);
    if (!within(canonicalIntake, source)) throw new Error("EVIDENCE_PATH_ESCAPE");
    const canonicalSource = await realpath(source).catch((error: unknown) => {
      throw new Error("VISUAL_EVIDENCE_UNREADABLE", { cause: error });
    });
    if (!within(canonicalIntake, canonicalSource) || source !== canonicalSource) {
      throw new Error("EVIDENCE_PATH_ESCAPE");
    }
    return source;
  }

  private async readDescriptor(
    issueId: string,
    evidenceId: string,
    repairIteration?: number,
  ): Promise<StoredEvidence> {
    assertSafeId(issueId);
    assertEvidenceId(evidenceId);
    const repairs = join(this.root, "issues", issueId, "repairs");
    const iterations = await readdir(repairs, { withFileTypes: true }).catch(() => []);
    const found: StoredEvidence[] = [];
    for (const entry of iterations) {
      if (!entry.isDirectory() || !/^[1-9]\d*$/.test(entry.name)) continue;
      const descriptorPath = join(repairs, entry.name, "evidence", `${evidenceId}.json`);
      const encoded = await readFile(descriptorPath, "utf8").catch(() => undefined);
      if (!encoded) continue;
      const parsed = parseStoredEvidence(encoded);
      if (
        !validDescriptor(parsed, issueId, evidenceId) ||
        parsed.repairIteration !== Number(entry.name)
      ) throw new Error("EVIDENCE_METADATA_INVALID");
      found.push(parsed);
    }
    const selected = repairIteration === undefined
      ? found.sort((left, right) => right.repairIteration - left.repairIteration)[0]
      : found.find((descriptor) => descriptor.repairIteration === repairIteration);
    if (!selected) throw new Error("EVIDENCE_NOT_FOUND");
    return selected;
  }
}

function validateScope(issueId: string, repairIteration: number): void {
  assertSafeId(issueId);
  if (!Number.isSafeInteger(repairIteration) || repairIteration <= 0) {
    throw new Error("INVALID_REPAIR_ITERATION");
  }
}

function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("INVALID_EVIDENCE_ISSUE_ID");
}

function assertEvidenceId(value: string): void {
  if (!/^sha256-[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_EVIDENCE_ID");
}

function parseStoredEvidence(value: string): StoredEvidence {
  try {
    return JSON.parse(value) as StoredEvidence;
  } catch (error) {
    throw new Error("EVIDENCE_METADATA_INVALID", { cause: error });
  }
}

function validDescriptor(value: StoredEvidence, issueId: string, evidenceId: string): boolean {
  if (
    !value ||
    value.issueId !== issueId ||
    value.evidenceId !== evidenceId ||
    !Number.isSafeInteger(value.repairIteration) ||
    value.repairIteration <= 0 ||
    (value.type !== "screenshot" && value.type !== "recording") ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    typeof value.mimeType !== "string" ||
    typeof value.path !== "string"
  ) return false;
  const expectedPrefix = value.type === "screenshot" ? "image/" : "video/";
  return value.mimeType.startsWith(expectedPrefix) &&
    Object.values(mimeTypes).includes(value.mimeType) &&
    value.path === join(
      "issues",
      issueId,
      "repairs",
      String(value.repairIteration),
      "evidence",
      `${evidenceId}${canonicalExtension(value.mimeType)}`,
    );
}

function canonicalExtension(mimeType: string): string {
  const extension = extensions[mimeType];
  if (!extension) throw new Error("EVIDENCE_METADATA_INVALID");
  return extension;
}

function safeChild(root: string, path: string, code: string): string {
  const target = resolve(root, path);
  if (!within(resolve(root), target)) throw new Error(code);
  return target;
}

function within(root: string, path: string): boolean {
  return path !== root && path.startsWith(`${root}${sep}`);
}

function missingInspection(evidenceId: string, repairIteration: number): EvidenceInspection {
  return {
    evidenceId,
    repairIteration,
    exists: false,
    byteLength: 0,
    mediaKind: "unsupported",
    decodes: false,
    playable: false,
    hasMediaPayload: false,
  };
}
