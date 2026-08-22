import type {
  AssessmentReference,
  ConfigValue,
  EvidencePayload,
  IntegrationPluginManifest,
  ProductProject,
  ProjectInspection,
  RuntimeOperationInput,
  RuntimeOperationOutput,
} from "@oh-my-bug/runtime/protocol";

export type ProjectDto = ProductProject;
export type IssueDto = RuntimeOperationOutput<"getIssue">;
export type AgentEventDto = RuntimeOperationOutput<"issueEvents">["items"][number];
export type IntegrationHealth = RuntimeOperationOutput<"integrationHealth">[string];
export type ApproveAssessmentInput = RuntimeOperationInput<"approveAssessment">["input"];
export type {
  AssessmentReference,
  ConfigValue,
  EvidencePayload,
  IntegrationPluginManifest,
  ProjectInspection,
};
