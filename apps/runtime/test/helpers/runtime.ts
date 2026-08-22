import type {
  AgentAdapter,
  AgentPlugin,
  Assessment,
  Issue,
  RuntimeProject,
} from "@oh-my-bug/core";
import { ManualIntegrationAdapter } from "@oh-my-bug/integration-manual";
import {
  openRuntimeDatabase,
  SqliteAgentSessionStore,
  SqliteRuntimeStore,
} from "@oh-my-bug/storage";

import { AgentRegistry } from "../../src/agents/registry.js";
import { RuntimeCommands } from "../../src/orchestration/commands.js";
import { fakeAssessment, FakeAgent, FakeEvidenceStore } from "./fakes.js";

export const now = "2026-08-20T15:00:00.000Z";
export const project: RuntimeProject = {
  id: "project-1",
  key: "OMB",
  path: "/tmp/project-1",
  agent: { plugin: "fake" },
};
export const assessment: Assessment = fakeAssessment;

export function eventIds(prefix = "event") {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

export function createHarness(agent: AgentAdapter = new FakeAgent()) {
  let wakes = 0;
  let sequence = 0;
  const id = () => `generated-${++sequence}`;
  const database = openRuntimeDatabase(":memory:");
  const store = new SqliteRuntimeStore(database, { id: () => "issue-1" });
  const sessions = new SqliteAgentSessionStore(database);
  const plugin: AgentPlugin = { id: "fake", create: () => agent };
  const agents = new AgentRegistry([plugin], { sessions });
  const evidence = new FakeEvidenceStore();
  const manual = new ManualIntegrationAdapter({ id: () => "input-1", now: () => new Date(now) });
  const commands = new RuntimeCommands({
    store,
    manual,
    agents,
    id,
    now: () => now,
    wake: () => { wakes += 1; },
  });
  commands.registerProject(project);
  return { commands, store, sessions, agents, evidence, wakes: () => wakes };
}

export function reviewedIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-reviewed",
    projectId: project.id,
    identifier: "OMB-2",
    title: "支付页打不开",
    titleSource: "integration",
    status: "ASSESSMENT_REVIEW",
    inputs: [],
    assessment,
    revision: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
