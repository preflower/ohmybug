import type {
  AssessmentReference,
  CreateProjectInput,
  IssueEventEnvelope,
  ManualIssueCommand,
  RuntimeOperation,
  RuntimeOperationInput,
  RuntimeOperationOutput,
  UpdateProjectInput,
} from "@oh-my-bug/runtime/protocol";
import type { TrayNavigationTarget } from "./tray-navigation.js";

export type { TrayNavigationTarget } from "./tray-navigation.js";

export const DESKTOP_REQUEST_CHANNEL = "oh-my-bug:request";
export const OPEN_PROJECT_DIRECTORY_CHANNEL = "oh-my-bug:open-project-directory";
export const SUBSCRIBE_ISSUE_CHANNEL = "oh-my-bug:subscribe-issue";
export const UNSUBSCRIBE_ISSUE_CHANNEL = "oh-my-bug:unsubscribe-issue";
export const ISSUE_EVENT_CHANNEL = "oh-my-bug:issue-event";
export const RUNTIME_STATE_CHANNEL = "oh-my-bug:runtime-state";
export const TRAY_NAVIGATION_CHANNEL = "oh-my-bug:tray-navigation";

export interface RendererIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): unknown;
}

export interface DesktopApi {
  listIntegrationPlugins(): Promise<RuntimeOperationOutput<"listIntegrationPlugins">>;
  listWorkspaceProviders(): Promise<RuntimeOperationOutput<"listWorkspaceProviders">>;
  listProjects(): Promise<RuntimeOperationOutput<"listProjects">>;
  inspectProject(path: string): Promise<RuntimeOperationOutput<"inspectProject">>;
  inspectProjectBranches(
    path: string,
    providerId: string,
    refreshRemote: boolean,
  ): Promise<RuntimeOperationOutput<"inspectProjectBranches">>;
  getProject(id: string): Promise<RuntimeOperationOutput<"getProject">>;
  saveProjectSettings(
    input: RuntimeOperationInput<"saveProjectSettings">,
  ): Promise<RuntimeOperationOutput<"saveProjectSettings">>;
  createProject(project: CreateProjectInput): Promise<RuntimeOperationOutput<"createProject">>;
  updateProject(id: string, input: UpdateProjectInput): Promise<RuntimeOperationOutput<"updateProject">>;
  setIntegrationSecrets(
    id: string,
    pluginId: string,
    patch: Record<string, string | null>,
  ): Promise<RuntimeOperationOutput<"setIntegrationSecrets">>;
  integrationHealth(): Promise<RuntimeOperationOutput<"integrationHealth">>;
  testSavedIntegration(
    projectId: string,
    integrationId: string,
  ): Promise<RuntimeOperationOutput<"testSavedIntegration">>;
  listIssues(projectId?: string): Promise<RuntimeOperationOutput<"listIssues">>;
  getIssue(id: string): Promise<RuntimeOperationOutput<"getIssue">>;
  getIssueWorkspace(id: string): Promise<RuntimeOperationOutput<"getIssueWorkspace">>;
  submitManual(input: ManualIssueCommand): Promise<RuntimeOperationOutput<"submitManual">>;
  submitReview(
    id: string,
    input: RuntimeOperationInput<"submitReview">["input"],
  ): Promise<RuntimeOperationOutput<"submitReview">>;
  approveAssessment(
    id: string,
    input: RuntimeOperationInput<"approveAssessment">["input"],
  ): Promise<RuntimeOperationOutput<"approveAssessment">>;
  /** @deprecated Use approveAssessment. */
  approveBugAssessment(
    id: string,
    input: RuntimeOperationInput<"approveBugAssessment">["input"],
  ): Promise<RuntimeOperationOutput<"approveBugAssessment">>;
  confirmNotABug(
    id: string,
    reference: AssessmentReference,
  ): Promise<RuntimeOperationOutput<"confirmNotABug">>;
  confirmDuplicate(
    id: string,
    reference: AssessmentReference,
    duplicateOf: string,
  ): Promise<RuntimeOperationOutput<"confirmDuplicate">>;
  requestReassessment(id: string, feedback: string): Promise<RuntimeOperationOutput<"requestReassessment">>;
  rejectDelivery(id: string, feedback: string): Promise<RuntimeOperationOutput<"rejectDelivery">>;
  approveDelivery(id: string): Promise<RuntimeOperationOutput<"approveDelivery">>;
  retryIssue(id: string): Promise<RuntimeOperationOutput<"retryIssue">>;
  rebuildAgentSession(
    id: string,
    expectedRevision: number,
  ): Promise<RuntimeOperationOutput<"rebuildAgentSession">>;
  grantIssueCapabilities(
    id: string,
    expectedRevision: number,
    requestId: string,
  ): Promise<RuntimeOperationOutput<"grantIssueCapabilities">>;
  pauseIssue(id: string): Promise<RuntimeOperationOutput<"pauseIssue">>;
  resumeIssue(id: string): Promise<RuntimeOperationOutput<"resumeIssue">>;
  cancelIssue(id: string): Promise<RuntimeOperationOutput<"cancelIssue">>;
  readEvidence(
    issueId: string,
    evidenceId: string,
  ): Promise<RuntimeOperationOutput<"readEvidence">>;
  openProjectDirectory(): Promise<unknown>;
  subscribeIssueEvents(
    issueId: string,
    cursor: number,
    listener: (event: IssueEventEnvelope) => void,
  ): () => void;
  onRuntimeState(listener: (state: unknown) => void): () => void;
  onTrayNavigation(listener: (target: TrayNavigationTarget) => void): () => void;
}

export function createDesktopApi(ipc: RendererIpc): Readonly<DesktopApi> {
  let subscriptionSequence = 0;
  const request = <Name extends RuntimeOperation>(
    operation: Name,
    payload: RuntimeOperationInput<Name>,
  ): Promise<RuntimeOperationOutput<Name>> =>
    ipc.invoke(DESKTOP_REQUEST_CHANNEL, { operation, payload }) as Promise<RuntimeOperationOutput<Name>>;
  const api: DesktopApi = {
    listIntegrationPlugins: () => request("listIntegrationPlugins", {}),
    listWorkspaceProviders: () => request("listWorkspaceProviders", {}),
    listProjects: () => request("listProjects", {}),
    inspectProject: (path) => request("inspectProject", { path }),
    inspectProjectBranches: (path, providerId, refreshRemote) =>
      request("inspectProjectBranches", { path, providerId, refreshRemote }),
    getProject: (id) => request("getProject", { id }),
    saveProjectSettings: (input) => request("saveProjectSettings", input),
    createProject: (project) => request("createProject", project),
    updateProject: (id, input) => request("updateProject", { id, input }),
    setIntegrationSecrets: (id, pluginId, patch) => request("setIntegrationSecrets", {
      id,
      pluginId,
      patch,
    }),
    integrationHealth: () => request("integrationHealth", {}),
    testSavedIntegration: (projectId, integrationId) => request("testSavedIntegration", {
      projectId,
      integrationId,
    }),
    listIssues: (id) => request("listIssues", { id }),
    getIssue: (id) => request("getIssue", { id }),
    getIssueWorkspace: (id) => request("getIssueWorkspace", { id }),
    submitManual: (input) => request("submitManual", input),
    submitReview: (id, input) => request("submitReview", { id, input }),
    approveAssessment: (id, input) => request("approveAssessment", { id, input }),
    approveBugAssessment: (id, input) => request("approveBugAssessment", { id, input }),
    confirmNotABug: (id, reference) => request("confirmNotABug", { id, reference }),
    confirmDuplicate: (id, reference, duplicateOf) => request("confirmDuplicate", {
      id,
      reference,
      duplicateOf,
    }),
    requestReassessment: (id, feedback) => request("requestReassessment", { id, feedback }),
    rejectDelivery: (id, feedback) => request("rejectDelivery", { id, feedback }),
    approveDelivery: (id) => request("approveDelivery", { id }),
    retryIssue: (id) => request("retryIssue", { id }),
    rebuildAgentSession: (id, expectedRevision) => request("rebuildAgentSession", {
      id,
      expectedRevision,
    }),
    grantIssueCapabilities: (id, expectedRevision, requestId) => request(
      "grantIssueCapabilities",
      { id, expectedRevision, requestId },
    ),
    pauseIssue: (id) => request("pauseIssue", { id }),
    resumeIssue: (id) => request("resumeIssue", { id }),
    cancelIssue: (id) => request("cancelIssue", { id }),
    readEvidence: (issueId, evidenceId) => request("readEvidence", { issueId, evidenceId }),
    openProjectDirectory: () => ipc.invoke(OPEN_PROJECT_DIRECTORY_CHANNEL),
    subscribeIssueEvents: (issueId, cursor, listener) => {
      const subscriptionId = `renderer-${++subscriptionSequence}`;
      let active = true;
      const onEvent = (_event: unknown, value: unknown) => {
        if (!active || !value || typeof value !== "object") return;
        const envelope = value as IssueEventEnvelope & { subscriptionId?: string };
        if (envelope.subscriptionId === subscriptionId) listener(envelope);
      };
      ipc.on(ISSUE_EVENT_CHANNEL, onEvent);
      void ipc.invoke(SUBSCRIBE_ISSUE_CHANNEL, { subscriptionId, issueId, cursor });
      return () => {
        if (!active) return;
        active = false;
        ipc.removeListener(ISSUE_EVENT_CHANNEL, onEvent);
        void ipc.invoke(UNSUBSCRIBE_ISSUE_CHANNEL, { subscriptionId });
      };
    },
    onRuntimeState: (listener) => {
      const onState = (_event: unknown, state: unknown) => listener(state);
      ipc.on(RUNTIME_STATE_CHANNEL, onState);
      return () => ipc.removeListener(RUNTIME_STATE_CHANNEL, onState);
    },
    onTrayNavigation: (listener) => {
      const onNavigation = (_event: unknown, value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        const issueId = (value as { issueId?: unknown }).issueId;
        if (issueId === undefined) listener({});
        else if (typeof issueId === "string" && issueId.trim().length > 0) {
          listener({ issueId });
        }
      };
      ipc.on(TRAY_NAVIGATION_CHANNEL, onNavigation);
      return () => ipc.removeListener(TRAY_NAVIGATION_CHANNEL, onNavigation);
    },
  };
  return Object.freeze(api);
}
