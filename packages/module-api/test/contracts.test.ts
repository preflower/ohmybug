import type { RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import type {
  BranchInfo,
  LifecycleEventMap,
  WorkspaceProviderFactory,
} from "../src/index.js";

describe("internal module contracts", () => {
  it("keeps branch data outside the Core project model", () => {
    const branch: BranchInfo = { name: "ohmybug/omb-1", commit: "abc123" };
    const project: RuntimeProject = { id: "p1", key: "P1", path: "/repo" };
    const factory = { id: "local" } as WorkspaceProviderFactory;
    const event: keyof LifecycleEventMap = "issue.completed";

    expect({ branch, project, factory: factory.id, event }).toBeTruthy();
  });
});
