import type {
  AssessmentReference,
  ConfigValue,
  EvidencePayload,
  IntegrationPluginManifest,
  ProductProject,
  ProjectInspection,
  RuntimeOperationInput,
  RuntimeOperationOutput,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
} from "@oh-my-bug/runtime/protocol";

export type ProjectDto = ProductProject;
export type IssueDto = RuntimeOperationOutput<"getIssue">;
export type ApprovalResultDto = RuntimeOperationOutput<"approveDelivery">;
export type BranchInfoDto = NonNullable<ApprovalResultDto["branch"]>;
export type AgentEventDto = RuntimeOperationOutput<"issueEvents">["items"][number];
export type IntegrationHealth = RuntimeOperationOutput<"integrationHealth">[string];
export type ApproveAssessmentInput = RuntimeOperationInput<"approveAssessment">["input"];
export type {
  AssessmentReference,
  ConfigValue,
  EvidencePayload,
  IntegrationPluginManifest,
  ProjectInspection,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
};
