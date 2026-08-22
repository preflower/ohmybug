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

export const DESKTOP_REQUEST_CHANNEL = "oh-my-bug:request";
export const OPEN_PROJECT_DIRECTORY_CHANNEL = "oh-my-bug:open-project-directory";
export const SUBSCRIBE_ISSUE_CHANNEL = "oh-my-bug:subscribe-issue";
export const UNSUBSCRIBE_ISSUE_CHANNEL = "oh-my-bug:unsubscribe-issue";
export const ISSUE_EVENT_CHANNEL = "oh-my-bug:issue-event";
export const RUNTIME_STATE_CHANNEL = "oh-my-bug:runtime-state";

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
  getProject(id: string): Promise<RuntimeOperationOutput<"getProject">>;
  createProject(project: CreateProjectInput): Promise<RuntimeOperationOutput<"createProject">>;
  updateProject(id: string, input: UpdateProjectInput): Promise<RuntimeOperationOutput<"updateProject">>;
  setIntegrationSecrets(
    id: string,
    pluginId: string,
    patch: Record<string, string | null>,
  ): Promise<RuntimeOperationOutput<"setIntegrationSecrets">>;
  integrationHealth(): Promise<RuntimeOperationOutput<"integrationHealth">>;
  listIssues(projectId?: string): Promise<RuntimeOperationOutput<"listIssues">>;
  getIssue(id: string): Promise<RuntimeOperationOutput<"getIssue">>;
  submitManual(input: ManualIssueCommand): Promise<RuntimeOperationOutput<"submitManual">>;
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
    getProject: (id) => request("getProject", { id }),
    createProject: (project) => request("createProject", project),
    updateProject: (id, input) => request("updateProject", { id, input }),
    setIntegrationSecrets: (id, pluginId, patch) => request("setIntegrationSecrets", {
      id,
      pluginId,
      patch,
    }),
    integrationHealth: () => request("integrationHealth", {}),
    listIssues: (id) => request("listIssues", { id }),
    getIssue: (id) => request("getIssue", { id }),
    submitManual: (input) => request("submitManual", input),
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
  };
  return Object.freeze(api);
}
