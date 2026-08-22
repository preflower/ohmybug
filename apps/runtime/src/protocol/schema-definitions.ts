import {
  integrationPluginManifestSchema,
  configFieldSchema,
  issueSchema,
} from "@oh-my-bug/core";
import { z } from "zod";

export const identifierSchema = z.string().trim().min(1);
export const messageIdSchema = z.string().min(1).max(128);
export const emptyPayloadSchema = z.object({}).strict();
export const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export const configSchema = z.record(z.string(), configValueSchema);
export const projectCommandsSchema = z.object({
  install: identifierSchema.optional(),
  test: identifierSchema.optional(),
  start: identifierSchema.optional(),
  acceptanceUrl: identifierSchema.optional(),
}).strict();
export const projectAgentSchema = z.object({ plugin: identifierSchema }).strict();
export const projectIntegrationInputSchema = z.object({
  enabled: z.boolean(),
  config: configSchema,
}).strict();
export const productIntegrationSchema = projectIntegrationInputSchema.extend({
  secretConfigured: z.record(z.string(), z.boolean()),
  unavailable: z.string().min(1).optional(),
}).strict();
export const workspaceConfigurationSchema = z.object({
  provider: identifierSchema,
  config: configSchema,
}).strict();
export const productWorkspaceConfigurationSchema = workspaceConfigurationSchema.extend({
  unavailable: z.string().min(1).optional(),
}).strict();
export const workspaceProviderManifestSchema = z.object({
  id: identifierSchema,
  name: identifierSchema,
  configFields: z.array(configFieldSchema),
}).strict();

const projectFields = {
  path: identifierSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
  name: identifierSchema.optional(),
  instructions: z.string().optional(),
  commands: projectCommandsSchema.optional(),
  agent: projectAgentSchema.optional(),
  integrations: z.record(identifierSchema, projectIntegrationInputSchema).optional(),
  workspace: workspaceConfigurationSchema.optional(),
};

export const createProjectInputSchema = z.object(projectFields).strict();
export const updateProjectInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  path: projectFields.path.optional(),
  key: projectFields.key.optional(),
  name: projectFields.name,
  instructions: projectFields.instructions,
  commands: projectFields.commands,
  agent: projectFields.agent,
  integrations: projectFields.integrations,
  workspace: projectFields.workspace,
}).strict();
export const productProjectSchema = z.object({
  id: identifierSchema,
  key: projectFields.key,
  path: projectFields.path,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  name: projectFields.name,
  instructions: projectFields.instructions,
  commands: projectFields.commands,
  agent: projectFields.agent,
  integrations: z.record(identifierSchema, productIntegrationSchema).optional(),
  workspace: productWorkspaceConfigurationSchema,
}).strict();
export const projectInspectionSchema = z.object({
  path: identifierSchema,
  name: identifierSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
}).strict();
export const manualIssueCommandSchema = z.object({
  projectId: identifierSchema,
  commandId: identifierSchema,
  content: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const assessmentReferenceSchema = z.object({
  assessmentRevision: z.number().int().positive(),
  assessmentContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const approveAssessmentInputSchema = assessmentReferenceSchema.extend({
  title: z.string().trim().min(1),
}).strict();
export const feedbackSchema = z.string().trim().min(1);
export const issueEventSchema = z.object({
  id: identifierSchema,
  issueId: identifierSchema,
  sequence: z.number().int().positive(),
  type: identifierSchema,
  actor: z.enum(["SYSTEM", "USER", "AGENT"]),
  data: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
}).strict();
export const issueEventPageSchema = z.object({
  items: z.array(issueEventSchema),
  nextCursor: z.number().int().nonnegative(),
}).strict();
export const integrationHealthSchema = z.object({
  state: z.enum(["stopped", "connecting", "connected", "backoff"]),
  lastSuccessAt: z.string().optional(),
  lastError: z.string().optional(),
  nextRetryAt: z.string().optional(),
}).strict();
export const runtimeHealthSchema = z.object({
  state: z.enum(["starting", "ready", "stopping", "stopped"]),
}).strict();
export const evidencePayloadSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mimeType: identifierSchema,
  label: identifierSchema,
}).strict();
export const branchInfoSchema = z.object({
  name: identifierSchema,
  commit: identifierSchema,
  remote: identifierSchema.optional(),
}).strict();
export const approvalResultSchema = z.object({
  issue: issueSchema,
  branch: branchInfoSchema.optional(),
}).strict();

export const outputSchemas = {
  issue: issueSchema,
  issues: z.array(issueSchema),
  manifest: integrationPluginManifestSchema,
  manifests: z.array(integrationPluginManifestSchema),
  workspaceManifests: z.array(workspaceProviderManifestSchema),
  approvalResult: approvalResultSchema,
};
