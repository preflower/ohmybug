const tokenArgument = "--oh-my-bug-e2e-demo-agent=";
const inheritedAgentVariables = new Set([
  "OMB_AGENT_MODE",
  "OH_MY_BUG_INTERNAL_E2E_AGENT_MODE",
  "OH_MY_BUG_INTERNAL_E2E_AGENT_DELAY_MS",
  "OH_MY_BUG_INTERNAL_E2E_AGENT_UNAVAILABLE_ONCE",
  "OH_MY_BUG_E2E_DEMO_AGENT_TOKEN",
  "OH_MY_BUG_E2E_DEMO_AGENT_DELAY_MS",
  "OH_MY_BUG_E2E_DEMO_AGENT_UNAVAILABLE_ONCE",
]);

export function buildUtilityProcessEnvironment(
  argv: readonly string[],
  inherited: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !inheritedAgentVariables.has(name)),
  );
  Object.assign(environment, overrides);
  const suppliedToken = argv.find((argument) => argument.startsWith(tokenArgument))
    ?.slice(tokenArgument.length);
  const expectedToken = inherited.OH_MY_BUG_E2E_DEMO_AGENT_TOKEN;
  if (
    suppliedToken &&
    expectedToken &&
    /^[a-zA-Z0-9_-]{32,128}$/.test(suppliedToken) &&
    suppliedToken === expectedToken
  ) {
    environment.OH_MY_BUG_INTERNAL_E2E_AGENT_MODE = "demo";
    const delayMs = Number(inherited.OH_MY_BUG_E2E_DEMO_AGENT_DELAY_MS ?? "0");
    if (Number.isInteger(delayMs) && delayMs > 0 && delayMs <= 60_000) {
      environment.OH_MY_BUG_INTERNAL_E2E_AGENT_DELAY_MS = String(delayMs);
    }
    if (inherited.OH_MY_BUG_E2E_DEMO_AGENT_UNAVAILABLE_ONCE === "true") {
      environment.OH_MY_BUG_INTERNAL_E2E_AGENT_UNAVAILABLE_ONCE = "true";
    }
  }
  return environment;
}
