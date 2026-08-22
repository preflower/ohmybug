import { z, type ZodType } from "zod";

import type {
  RuntimeApi,
  RuntimeOperation,
  RuntimeOperationInput,
  RuntimeOperationOutput,
} from "./types.js";
import {
  approveAssessmentInputSchema,
  assessmentReferenceSchema,
  createProjectInputSchema,
  emptyPayloadSchema,
  evidencePayloadSchema,
  feedbackSchema,
  identifierSchema,
  integrationHealthSchema,
  issueEventPageSchema,
  manualIssueCommandSchema,
  outputSchemas,
  productProjectSchema,
  projectInspectionSchema,
  runtimeHealthSchema,
  updateProjectInputSchema,
} from "./schema-definitions.js";

export interface RuntimeOperationDefinition<Input = unknown, Output = unknown> {
  input: ZodType<Input>;
  output: ZodType<Output>;
  renderer: boolean;
  invoke(service: RuntimeApi, input: Input): Promise<Output>;
}

function operation<Input, Output>(
  definition: RuntimeOperationDefinition<Input, Output>,
): RuntimeOperationDefinition<Input, Output> {
  return definition;
}

const projectIdSchema = z.object({ id: identifierSchema }).strict();
const listIssuesSchema = z.object({ id: identifierSchema.optional() }).strict();

type RuntimeOperationRegistry = {
  [Name in RuntimeOperation]: RuntimeOperationDefinition<
    RuntimeOperationInput<Name>,
    RuntimeOperationOutput<Name>
  >;
};

export const runtimeOperations = {
  health: operation({
    input: emptyPayloadSchema,
    output: runtimeHealthSchema,
    renderer: false,
    invoke: (service, input) => service.health(input),
  }),
  listIntegrationPlugins: operation({
    input: emptyPayloadSchema,
    output: outputSchemas.manifests,
    renderer: true,
    invoke: (service, input) => service.listIntegrationPlugins(input),
  }),
  listWorkspaceProviders: operation({
    input: emptyPayloadSchema,
    output: outputSchemas.workspaceManifests,
    renderer: true,
    invoke: (service, input) => service.listWorkspaceProviders(input),
  }),
  listProjects: operation({
    input: emptyPayloadSchema,
    output: z.array(productProjectSchema),
    renderer: true,
    invoke: (service, input) => service.listProjects(input),
  }),
  inspectProject: operation({
    input: z.object({ path: identifierSchema }).strict(),
    output: projectInspectionSchema,
    renderer: true,
    invoke: (service, input) => service.inspectProject(input),
  }),
  getProject: operation({
    input: projectIdSchema,
    output: productProjectSchema,
    renderer: true,
    invoke: (service, input) => service.getProject(input),
  }),
  createProject: operation({
    input: createProjectInputSchema,
    output: productProjectSchema,
    renderer: true,
    invoke: (service, input) => service.createProject(input),
  }),
  updateProject: operation({
    input: z.object({ id: identifierSchema, input: updateProjectInputSchema }).strict(),
    output: productProjectSchema,
    renderer: true,
    invoke: (service, input) => service.updateProject(input),
  }),
  setIntegrationSecrets: operation({
    input: z.object({
      id: identifierSchema,
      pluginId: identifierSchema,
      patch: z.record(identifierSchema, z.string().min(1).nullable()),
    }).strict(),
    output: productProjectSchema,
    renderer: true,
    invoke: (service, input) => service.setIntegrationSecrets(input),
  }),
  integrationHealth: operation({
    input: emptyPayloadSchema,
    output: z.record(z.string(), integrationHealthSchema),
    renderer: true,
    invoke: (service, input) => service.integrationHealth(input),
  }),
  listIssues: operation({
    input: listIssuesSchema,
    output: outputSchemas.issues,
    renderer: true,
    invoke: (service, input) => service.listIssues(input),
  }),
  getIssue: operation({
    input: projectIdSchema,
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.getIssue(input),
  }),
  submitManual: operation({
    input: manualIssueCommandSchema,
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.submitManual(input),
  }),
  approveAssessment: operation({
    input: z.object({ id: identifierSchema, input: approveAssessmentInputSchema }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.approveAssessment(input),
  }),
  approveBugAssessment: operation({
    input: z.object({ id: identifierSchema, input: approveAssessmentInputSchema }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.approveBugAssessment(input),
  }),
  confirmNotABug: operation({
    input: z.object({ id: identifierSchema, reference: assessmentReferenceSchema }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.confirmNotABug(input),
  }),
  confirmDuplicate: operation({
    input: z.object({
      id: identifierSchema,
      reference: assessmentReferenceSchema,
      duplicateOf: identifierSchema,
    }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.confirmDuplicate(input),
  }),
  requestReassessment: operation({
    input: z.object({ id: identifierSchema, feedback: feedbackSchema }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.requestReassessment(input),
  }),
  rejectDelivery: operation({
    input: z.object({ id: identifierSchema, feedback: feedbackSchema }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.rejectDelivery(input),
  }),
  approveDelivery: operation({
    input: projectIdSchema,
    output: outputSchemas.approvalResult,
    renderer: true,
    invoke: (service, input) => service.approveDelivery(input),
  }),
  retryIssue: operation({
    input: projectIdSchema,
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.retryIssue(input),
  }),
  rebuildAgentSession: operation({
    input: z.object({
      id: identifierSchema,
      expectedRevision: z.number().int().positive(),
    }).strict(),
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.rebuildAgentSession(input),
  }),
  cancelIssue: operation({
    input: projectIdSchema,
    output: outputSchemas.issue,
    renderer: true,
    invoke: (service, input) => service.cancelIssue(input),
  }),
  issueEvents: operation({
    input: z.object({
      id: identifierSchema,
      cursor: z.number().int().nonnegative(),
    }).strict(),
    output: issueEventPageSchema,
    renderer: false,
    invoke: (service, input) => service.issueEvents(input),
  }),
  readEvidence: operation({
    input: z.object({ issueId: identifierSchema, evidenceId: identifierSchema }).strict(),
    output: evidencePayloadSchema,
    renderer: true,
    invoke: (service, input) => service.readEvidence(input),
  }),
  shutdown: operation({
    input: emptyPayloadSchema,
    output: z.null(),
    renderer: false,
    invoke: (service, input) => service.shutdown(input),
  }),
} satisfies RuntimeOperationRegistry;

export const rendererOperationNames = (Object.entries(runtimeOperations) as Array<[
  RuntimeOperation,
  RuntimeOperationDefinition,
]>).filter(([, definition]) => definition.renderer).map(([name]) => name);
