import type { WorkspaceProviderFactory } from "@oh-my-bug/module-api";

export const localWorkspaceFactory: WorkspaceProviderFactory = {
  id: "local",
  manifest: { id: "local", name: "本机目录", configFields: [] },
  validate() {},
  create() {
    return {
      id: "local",
      async acquire({ issue, project }) {
        return {
          projectPath: project.path,
          resourceId: `local:${issue.id}`,
        };
      },
      async observeRepair() {
        return { required: false };
      },
      async validateRepair({ issue, resourceId, observation, result }) {
        if (
          observation.required
          || result.kind !== "DELIVERY_READY"
          || result.integration
        ) {
          throw new Error("LOCAL_REPAIR_INTEGRATION_UNSUPPORTED");
        }
        return {
          kind: "DELIVERY_READY",
          branch: {
            name: resourceId,
            commit: `local-revision:${issue.revision}`,
          },
        };
      },
      async publish() { return { kind: "PUBLISHED" as const }; },
      async release() {},
    };
  },
};
