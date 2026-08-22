import { describe, expect, it } from "vitest";

import {
  MemorySecretStore,
} from "../../src/keychain/secret-store.js";

describe("secret store contract", () => {
  it("stores, replaces, and deletes values by opaque reference", async () => {
    const secrets = new MemorySecretStore();

    expect(await secrets.get("project-1:sentry")).toBeNull();
    await secrets.set("project-1:sentry", "first-token");
    await secrets.set("project-1:sentry", "replacement-token");
    expect(await secrets.get("project-1:sentry")).toBe("replacement-token");
    await secrets.delete("project-1:sentry");
    expect(await secrets.get("project-1:sentry")).toBeNull();
  });
});
