import type { DesktopApi } from "../../electron/desktop-api.js";
import type { AgentEventDto } from "./types.js";
import {
  createProjectPayload,
  updateProjectPayload,
  type DirectorySelection,
  type ProductTransport,
} from "./transport.js";

export function createDesktopTransport(bridge: Readonly<DesktopApi>): ProductTransport {
  return {
    integrationPlugins: () => bridge.listIntegrationPlugins(),
    projects: () => bridge.listProjects(),
    project: (id) => bridge.getProject(id),
    createProject: (project) => bridge.createProject(createProjectPayload(project)),
    updateProject: (id, project) => bridge.updateProject(id, updateProjectPayload(project)),
    saveIntegrationSecrets: (id, pluginId, patch) =>
      bridge.setIntegrationSecrets(id, pluginId, patch),
    issues: () => bridge.listIssues(),
    issue: (id) => bridge.getIssue(id),
    submitManual: (input) => bridge.submitManual(input),
    approveAssessment: (id, input) => bridge.approveAssessment(id, input),
    confirmNotABug: (id, reference) => bridge.confirmNotABug(id, reference),
    confirmDuplicate: (id, reference, duplicateOf) =>
      bridge.confirmDuplicate(id, reference, duplicateOf),
    requestReassessment: (id, feedback) => bridge.requestReassessment(id, feedback),
    rejectDelivery: (id, feedback) => bridge.rejectDelivery(id, feedback),
    approveDelivery: (id) => bridge.approveDelivery(id),
    cancel: (id) => bridge.cancelIssue(id),
    retry: (id) => bridge.retryIssue(id),
    rebuildSession: (id, expectedRevision) => bridge.rebuildAgentSession(id, expectedRevision),
    integrationHealth: () => bridge.integrationHealth(),
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
