import type { Issue } from "@oh-my-bug/core";
import type { WorkspacePersistence } from "@oh-my-bug/module-api";

import type { WorkspaceRegistry } from "../modules/workspace-registry.js";
import type { IssueWorkspaceInfo } from "../protocol/types.js";

export async function readIssueWorkspaceInfo(input: {
  issue: Issue;
  persistence: WorkspacePersistence;
  registry: Pick<WorkspaceRegistry, "create">;
}): Promise<IssueWorkspaceInfo | null> {
  const binding = input.persistence.getBinding(input.issue.id);
  if (!binding) return null;

  const base: IssueWorkspaceInfo = {
    providerId: binding.providerId,
    status: binding.status,
  };
  try {
    const configured = input.persistence.getProjectConfiguration(input.issue.projectId);
    const config = configured?.provider === binding.providerId ? configured.config : {};
    const provider = input.registry.create(binding.providerId, config);
    const description = await provider.describe?.({
      issue: input.issue,
      resourceId: binding.resourceId,
    });
    return description?.branch ? { ...base, branch: description.branch } : base;
  } catch {
    return base;
  }
}
