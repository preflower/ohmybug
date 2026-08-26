import type { DesktopApi } from "../../electron/desktop-api.js";
import type { AgentEventDto } from "./types.js";
import {
  createProjectPayload,
  saveProjectSettingsPayload,
  updateProjectPayload,
  type DirectorySelection,
  type ProductTransport,
} from "./transport.js";

export function createDesktopTransport(bridge: Readonly<DesktopApi>): ProductTransport {
  return {
    integrationPlugins: () => bridge.listIntegrationPlugins(),
    workspaceProviders: () => bridge.listWorkspaceProviders(),
    projects: () => bridge.listProjects(),
    inspectProject: (path) => bridge.inspectProject(path),
    projectBranches: (path, providerId, refreshRemote) =>
      bridge.inspectProjectBranches(path, providerId, refreshRemote),
    project: (id) => bridge.getProject(id),
    createProject: (project) => bridge.createProject(createProjectPayload(project)),
    updateProject: (id, project) => bridge.updateProject(id, updateProjectPayload(project)),
    saveProjectSettings: (project, secretPatches) =>
      bridge.saveProjectSettings(saveProjectSettingsPayload(project, secretPatches)),
    saveIntegrationSecrets: (id, pluginId, patch) =>
      bridge.setIntegrationSecrets(id, pluginId, patch),
    issues: () => bridge.listIssues(),
    issue: (id) => bridge.getIssue(id),
    agentTerminalAvailability: (id) => bridge.agentTerminalAvailability(id),
    openAgentTerminal: (id) => bridge.openAgentTerminal(id),
    issueWorkspace: (id) => bridge.getIssueWorkspace(id),
    submitManual: (input) => bridge.submitManual(input),
    submitReview: (id, input) => bridge.submitReview(id, input),
    approveAssessment: (id, input) => bridge.approveAssessment(id, input),
    confirmNotABug: (id, reference) => bridge.confirmNotABug(id, reference),
    confirmDuplicate: (id, reference, duplicateOf) =>
      bridge.confirmDuplicate(id, reference, duplicateOf),
    requestReassessment: (id, feedback) => bridge.requestReassessment(id, feedback),
    rejectDelivery: (id, feedback) => bridge.rejectDelivery(id, feedback),
    approveDelivery: (id) => bridge.approveDelivery(id),
    pause: (id) => bridge.pauseIssue(id),
    resume: (id) => bridge.resumeIssue(id),
    cancel: (id) => bridge.cancelIssue(id),
    retry: (id) => bridge.retryIssue(id),
    rebuildSession: (id, expectedRevision) => bridge.rebuildAgentSession(id, expectedRevision),
    grantIssueCapabilities: (id, expectedRevision, requestId) =>
      bridge.grantIssueCapabilities(id, expectedRevision, requestId),
    integrationHealth: () => bridge.integrationHealth(),
    testSavedIntegration: (projectId, integrationId) =>
      bridge.testSavedIntegration(projectId, integrationId),
    openProjectDirectory: () => bridge.openProjectDirectory() as Promise<DirectorySelection>,
    subscribeIssueEvents: (id, cursor, listener) => bridge.subscribeIssueEvents(
      id,
      cursor,
      (envelope) => listener(envelope.events as AgentEventDto[], envelope.cursor),
    ),
    evidenceSource: async (issueId, evidenceId) => {
      const evidence = await bridge.readEvidence(issueId, evidenceId);
      const bytes = new Uint8Array(evidence.bytes);
      const url = URL.createObjectURL(new Blob([bytes], { type: evidence.mimeType }));
      return { url, revoke: () => URL.revokeObjectURL(url) };
    },
  };
}
