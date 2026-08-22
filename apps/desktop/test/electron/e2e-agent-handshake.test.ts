import { describe, expect, it } from "vitest";

import { buildUtilityProcessEnvironment } from "../../src/electron/e2e-agent-handshake.js";

describe("Electron E2E Agent handshake", () => {
  it("ignores inherited demo switches without a matching one-time token", () => {
    const environment = buildUtilityProcessEnvironment([], {
      OMB_AGENT_MODE: "demo",
      OH_MY_BUG_INTERNAL_E2E_AGENT_MODE: "demo",
      OH_MY_BUG_E2E_DEMO_AGENT_TOKEN: "inherited-token",
      OH_MY_BUG_E2E_DEMO_AGENT_DELAY_MS: "30000",
      OH_MY_BUG_E2E_DEMO_AGENT_UNAVAILABLE_ONCE: "true",
      SAFE_VALUE: "kept",
    }, { OH_MY_BUG_HOME: "/tmp/data" });

    expect(environment).toEqual({ SAFE_VALUE: "kept", OH_MY_BUG_HOME: "/tmp/data" });
  });

  it("enables Demo only for the E2E harness matching a strong argv token", () => {
    const token = "e2e-token-1234567890-abcdefghijklmnop";
    const environment = buildUtilityProcessEnvironment([
      `--oh-my-bug-e2e-demo-agent=${token}`,
    ], {
      OH_MY_BUG_E2E_DEMO_AGENT_TOKEN: token,
      OH_MY_BUG_E2E_DEMO_AGENT_DELAY_MS: "30000",
      OH_MY_BUG_E2E_DEMO_AGENT_UNAVAILABLE_ONCE: "true",
      SAFE_VALUE: "kept",
    }, { OH_MY_BUG_HOME: "/tmp/data" });

    expect(environment).toEqual({
      SAFE_VALUE: "kept",
      OH_MY_BUG_HOME: "/tmp/data",
      OH_MY_BUG_INTERNAL_E2E_AGENT_MODE: "demo",
      OH_MY_BUG_INTERNAL_E2E_AGENT_DELAY_MS: "30000",
      OH_MY_BUG_INTERNAL_E2E_AGENT_UNAVAILABLE_ONCE: "true",
    });
  });

  it("rejects short or mismatched E2E tokens", () => {
    expect(buildUtilityProcessEnvironment([
      "--oh-my-bug-e2e-demo-agent=short",
    ], { OH_MY_BUG_E2E_DEMO_AGENT_TOKEN: "short" }, {}))
      .not.toHaveProperty("OH_MY_BUG_INTERNAL_E2E_AGENT_MODE");
    expect(buildUtilityProcessEnvironment([
      "--oh-my-bug-e2e-demo-agent=e2e-token-1234567890-abcdefghijklmnop",
    ], { OH_MY_BUG_E2E_DEMO_AGENT_TOKEN: "different-token-1234567890-abcdefghijk" }, {}))
      .not.toHaveProperty("OH_MY_BUG_INTERNAL_E2E_AGENT_MODE");
  });
});
