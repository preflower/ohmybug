import { z } from "zod";

import type { ProjectCommands, ProjectContext } from "../agent/adapter.js";
import type { Issue } from "../issue/types.js";

export type PendingOperation =
  | "PREPARE"
  | "ASSESS"
  | "REPAIR"
  | "EVIDENCE"
  | "FINALIZE";
export type IssueEventActor = "SYSTEM" | "USER" | "AGENT";

export type ConfigValue = string | number | boolean | string[];

export interface ProjectAgentConfiguration {
  plugin: string;
}

export interface ProjectIntegrationConfiguration {
  enabled: boolean;
  config: Record<string, ConfigValue>;
  secretRefs: Record<string, string>;
}

export interface RuntimeProject extends ProjectContext {
  key: string;
  name?: string;
  commands?: ProjectCommands;
  agent?: ProjectAgentConfiguration;
  integrations?: Record<string, ProjectIntegrationConfiguration>;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
const configSchema = z.record(z.string(), configValueSchema);
export const projectEvidenceCaptureSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("browser"),
    label: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
  z.object({
    mode: z.literal("electron"),
    label: z.string().trim().min(1),
    electronEntry: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
  z.object({
    mode: z.literal("command"),
    label: z.string().trim().min(1),
    command: z.string().trim().min(1),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  }).strict(),
]);

export const projectCommandsSchema = z.object({
  install: z.string().trim().min(1).optional(),
  test: z.string().trim().min(1).optional(),
  start: z.string().trim().min(1).optional(),
  acceptanceUrl: z.string().trim().min(1).optional(),
  evidenceCapture: projectEvidenceCaptureSchema.optional(),
}).strict().superRefine((commands, context) => {
  if (commands.evidenceCapture?.mode !== "browser") return;
  if (!commands.start || !commands.acceptanceUrl) {
    context.addIssue({ code: "custom", message: "BROWSER_CAPTURE_COMMANDS_REQUIRED" });
    return;
  }
  let url: URL;
  try {
    url = new URL(commands.acceptanceUrl);
  } catch {
    context.addIssue({ code: "custom", message: "ACCEPTANCE_URL_INVALID" });
    return;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    context.addIssue({ code: "custom", message: "ACCEPTANCE_URL_MUST_BE_LOCALHOST" });
  }
});
const agentConfigurationSchema = z.object({
  plugin: z.string().trim().min(1),
}).strict();
const integrationConfigurationSchema = z.object({
  enabled: z.boolean(),
  config: configSchema,
  secretRefs: z.record(z.string(), z.string().trim().min(1)),
}).strict();

export const runtimeProjectSchema: z.ZodType<RuntimeProject> = z
  .object({
    id: z.string().trim().min(1),
    key: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
    path: z.string().trim().min(1),
    instructions: z.string().optional(),
    name: z.string().trim().min(1).optional(),
    commands: projectCommandsSchema.optional(),
    agent: agentConfigurationSchema.optional(),
    integrations: z.record(z.string(), integrationConfigurationSchema).optional(),
    revision: z.number().int().positive().optional(),
    createdAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export interface IssueEvent {
  id: string;
  issueId: string;
  sequence: number;
  type: string;
  actor: IssueEventActor;
  data: Record<string, unknown>;
  occurredAt: string;
}

export type NewIssueEvent = Omit<IssueEvent, "sequence">;

export type IntakeResult =
  | { kind: "IGNORED_DUPLICATE"; issueId: string }
  | { kind: "APPENDED"; issue: Issue }
  | { kind: "CREATED"; issue: Issue };
