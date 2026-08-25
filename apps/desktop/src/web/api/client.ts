import type { DesktopApi } from "../../electron/desktop-api.js";
import {
  createBrowserDevelopmentTransport,
  type DevelopmentSnapshotFetch,
} from "./browser-development-transport.js";
import { createDesktopTransport } from "./desktop-transport.js";
import type { ProductTransport } from "./transport.js";

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

function unavailable(): Promise<never> {
  return Promise.reject(new ApiError("Desktop Runtime 不可用", "DESKTOP_BRIDGE_UNAVAILABLE"));
}

const unavailableTransport: ProductTransport = {
  integrationPlugins: unavailable,
  workspaceProviders: unavailable,
  projects: unavailable,
  inspectProject: unavailable,
  projectBranches: unavailable,
  project: unavailable,
  createProject: unavailable,
  updateProject: unavailable,
  saveProjectSettings: unavailable,
  saveIntegrationSecrets: unavailable,
  issues: unavailable,
  issue: unavailable,
  issueWorkspace: unavailable,
  submitManual: unavailable,
  approveAssessment: unavailable,
  confirmNotABug: unavailable,
  confirmDuplicate: unavailable,
  requestReassessment: unavailable,
  rejectDelivery: unavailable,
  approveDelivery: unavailable,
  cancel: unavailable,
  retry: unavailable,
  rebuildSession: unavailable,
  grantIssueCapabilities: unavailable,
  integrationHealth: unavailable,
  openProjectDirectory: unavailable,
  subscribeIssueEvents: () => () => undefined,
  evidenceSource: unavailable,
};

export function createProductTransport(options: {
  bridge?: Readonly<DesktopApi>;
  development?: boolean;
  fetch?: DevelopmentSnapshotFetch;
} = {}): ProductTransport {
  const bridge = options.bridge ?? window.ohMyBug;
  if (bridge) return createDesktopTransport(bridge);
  if (options.development ?? import.meta.env.DEV) {
    const fetchSnapshot = options.fetch ?? globalThis.fetch.bind(globalThis);
    return createBrowserDevelopmentTransport(fetchSnapshot);
  }
  return unavailableTransport;
}

export const api: ProductTransport = createProductTransport();
