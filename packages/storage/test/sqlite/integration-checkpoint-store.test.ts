import { describe, expect, it } from "vitest";

import {
  openRuntimeDatabase,
  SqliteIntegrationCheckpointStore,
  SqliteRuntimeStore,
} from "../../src/index.js";
import { now, project } from "../helpers.js";

describe("SQLite Integration checkpoints", () => {
  it("round-trips and deletes one project Integration checkpoint", () => {
    const database = openRuntimeDatabase(":memory:");
    const runtimeStore = new SqliteRuntimeStore(database, { now: () => now });
    runtimeStore.registerProject(project);
    const checkpoints = new SqliteIntegrationCheckpointStore(database);

    checkpoints.save(project.id, "sentry", "cursor", "next-1");
    expect(checkpoints.get(project.id, "sentry", "cursor")).toBe("next-1");
    expect(checkpoints.get(project.id, "dingTalk", "cursor")).toBeUndefined();

    checkpoints.save(project.id, "sentry", "cursor", undefined);
    expect(checkpoints.get(project.id, "sentry", "cursor")).toBeUndefined();
    runtimeStore.close();
  });
});
