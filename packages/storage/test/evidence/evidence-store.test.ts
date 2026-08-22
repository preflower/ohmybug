import { realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalEvidenceStore } from "../../src/evidence/evidence-store.js";
import { createTempDir } from "../helpers.js";

const cleanups: Array<() => Promise<void>> = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function evidenceStore(): Promise<{ store: LocalEvidenceStore; root: string }> {
  const temporary = await createTempDir("oh-my-bug-evidence-");
  cleanups.push(temporary.cleanup);
  const root = join(temporary.path, "storage");
  return { store: new LocalEvidenceStore(root), root };
}

async function evidenceWorkspace(): Promise<string> {
  const temporary = await createTempDir("oh-my-bug-project-");
  cleanups.push(temporary.cleanup);
  return temporary.path;
}

describe("local evidence store", () => {
  it("stages Agent evidence in the project workspace before importing it into private storage", async () => {
    const { store, root } = await evidenceStore();
    const workspaceDirectory = await evidenceWorkspace();
    const canonicalWorkspace = await realpath(workspaceDirectory);
    const intake = await store.prepareIntake("issue-1", 2, workspaceDirectory);
    expect(relative(canonicalWorkspace, intake.directory)).toMatch(/^\.oh-my-bug-tmp-evidence-/);
    expect(relative(root, intake.directory)).toMatch(/^\.\./);
    await writeFile(join(intake.directory, "proof.png"), png);

    const evidence = await store.import({
      issueId: "issue-1",
      repairIteration: 2,
      workspaceDirectory,
      intakeDirectory: intake.directory,
      relativePath: "proof.png",
      type: "screenshot",
      label: "Correct result",
    });

    expect(evidence).toMatchObject({
      type: "screenshot",
      label: "Correct result",
      evidenceId: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
    });
    await expect(store.read("issue-1", evidence.evidenceId)).resolves.toMatchObject({
      bytes: png,
      mimeType: "image/png",
      label: "Correct result",
    });
    await expect(store.inspect("issue-1", 2, evidence.evidenceId)).resolves.toMatchObject({
      evidenceId: evidence.evidenceId,
      repairIteration: 2,
      exists: true,
      mediaKind: "image",
      decodes: true,
    });
    await intake.cleanup();
    await expect(writeFile(join(intake.directory, "late.png"), png)).rejects.toThrow();
  });

  it("rejects paths outside intake and never follows evidence symlinks", async () => {
    const temporary = await createTempDir("oh-my-bug-evidence-source-");
    cleanups.push(temporary.cleanup);
    const { store } = await evidenceStore();
    const workspaceDirectory = await evidenceWorkspace();
    const intake = await store.prepareIntake("issue-1", 1, workspaceDirectory);
    const outside = join(temporary.path, "outside.png");
    await writeFile(outside, png);
    await symlink(outside, join(intake.directory, "linked.png"));

    await expect(store.import({
      issueId: "issue-1",
      repairIteration: 1,
      workspaceDirectory,
      intakeDirectory: intake.directory,
      relativePath: "../outside.png",
      type: "screenshot",
      label: "Escaped",
    })).rejects.toThrow("EVIDENCE_PATH_ESCAPE");
    await expect(store.import({
      issueId: "issue-1",
      repairIteration: 1,
      workspaceDirectory,
      intakeDirectory: intake.directory,
      relativePath: "linked.png",
      type: "screenshot",
      label: "Symlinked",
    })).rejects.toThrow("EVIDENCE_PATH_ESCAPE");

    await intake.cleanup();
  });

  it("rejects an intake that is outside the declared project workspace", async () => {
    const { store } = await evidenceStore();
    const workspaceDirectory = await evidenceWorkspace();
    const otherWorkspace = await evidenceWorkspace();
    const intake = await store.prepareIntake("issue-1", 1, workspaceDirectory);
    await writeFile(join(intake.directory, "proof.png"), png);

    await expect(store.import({
      issueId: "issue-1",
      repairIteration: 1,
      workspaceDirectory: otherWorkspace,
      intakeDirectory: intake.directory,
      relativePath: "proof.png",
      type: "screenshot",
      label: "Wrong workspace",
    })).rejects.toThrow("EVIDENCE_INTAKE_INVALID");

    await intake.cleanup();
  });

  it("detects stored byte tampering on read", async () => {
    const { store, root } = await evidenceStore();
    const workspaceDirectory = await evidenceWorkspace();
    const intake = await store.prepareIntake("issue-1", 1, workspaceDirectory);
    await writeFile(join(intake.directory, "proof.png"), png);
    const evidence = await store.import({
      issueId: "issue-1",
      repairIteration: 1,
      workspaceDirectory,
      intakeDirectory: intake.directory,
      relativePath: "proof.png",
      type: "screenshot",
      label: "Correct result",
    });
    const path = join(
      root,
      "issues",
      "issue-1",
      "repairs",
      "1",
      "evidence",
      `${evidence.evidenceId}.png`,
    );
    await rm(path);
    await writeFile(path, "tampered", "utf8");

    await expect(store.read("issue-1", evidence.evidenceId)).rejects.toThrow("EVIDENCE_INTEGRITY_ERROR");
    await intake.cleanup();
  });

  it("accepts the same content-addressed evidence in later Repair iterations", async () => {
    const { store } = await evidenceStore();
    const workspaceDirectory = await evidenceWorkspace();
    const first = await store.prepareIntake("issue-1", 1, workspaceDirectory);
    const second = await store.prepareIntake("issue-1", 2, workspaceDirectory);
    await writeFile(join(first.directory, "proof.png"), png);
    await writeFile(join(second.directory, "proof.png"), png);

    const firstEvidence = await store.import({
      issueId: "issue-1",
      repairIteration: 1,
      workspaceDirectory,
      intakeDirectory: first.directory,
      relativePath: "proof.png",
      type: "screenshot",
      label: "First proof",
    });
    const secondEvidence = await store.import({
      issueId: "issue-1",
      repairIteration: 2,
      workspaceDirectory,
      intakeDirectory: second.directory,
      relativePath: "proof.png",
      type: "screenshot",
      label: "Latest proof",
    });

    expect(secondEvidence.evidenceId).toBe(firstEvidence.evidenceId);
    await expect(store.read("issue-1", firstEvidence.evidenceId)).resolves.toMatchObject({
      bytes: png,
      label: "Latest proof",
    });
    await expect(store.inspect("issue-1", 1, firstEvidence.evidenceId)).resolves.toMatchObject({
      exists: true,
      repairIteration: 1,
    });
    await expect(store.inspect("issue-1", 2, firstEvidence.evidenceId)).resolves.toMatchObject({
      exists: true,
      repairIteration: 2,
    });
    await first.cleanup();
    await second.cleanup();
  });
});
