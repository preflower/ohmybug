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
      async publish() { return undefined; },
      async release() {},
    };
  },
};
