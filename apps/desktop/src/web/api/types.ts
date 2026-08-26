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
export type IssueWorkspaceInfoDto = RuntimeOperationOutput<"getIssueWorkspace">;
export type ApprovalResultDto = RuntimeOperationOutput<"approveDelivery">;
export type BranchInfoDto = NonNullable<ApprovalResultDto["branch"]>;
export type WorkspaceBranchDiscoveryDto = RuntimeOperationOutput<"inspectProjectBranches">;
export type AgentEventDto = RuntimeOperationOutput<"issueEvents">["items"][number];
export type IntegrationHealth = RuntimeOperationOutput<"integrationHealth">[string];
export type IntegrationConnectionTestResult = RuntimeOperationOutput<"testSavedIntegration">;
export type ApproveAssessmentInput = RuntimeOperationInput<"approveAssessment">["input"];
export type ReviewSubmissionInput = RuntimeOperationInput<"submitReview">["input"];
export type {
  AssessmentReference,
  ConfigValue,
  EvidencePayload,
  IntegrationPluginManifest,
  ProjectInspection,
  WorkspaceProviderInspection,
  WorkspaceProviderManifest,
};
