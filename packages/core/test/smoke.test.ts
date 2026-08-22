import { describe, expect, it } from "vitest";

import { CORE_PACKAGE_NAME } from "../src/index.js";

describe("@oh-my-bug/core", () => {
  it("exposes its package identity", () => {
    expect(CORE_PACKAGE_NAME).toBe("@oh-my-bug/core");
  });
});
