import { createRuntimeApplication } from "./composition.js";
import { createRuntimeServer, type RuntimeMessagePort } from "./protocol/server.js";

interface ElectronParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  off(event: "message", listener: (event: { data: unknown }) => void): unknown;
}

class ParentPortAdapter implements RuntimeMessagePort {
  private readonly wrappers = new Map<
    (message: unknown) => void,
    (event: { data: unknown }) => void
  >();

  constructor(private readonly port: ElectronParentPort) {}

  postMessage(message: unknown): void { this.port.postMessage(message); }

  on(_event: "message", listener: (message: unknown) => void): void {
    const wrapper = (event: { data: unknown }) => listener(event.data);
    this.wrappers.set(listener, wrapper);
    this.port.on("message", wrapper);
  }

  off(_event: "message", listener: (message: unknown) => void): void {
    const wrapper = this.wrappers.get(listener);
    if (!wrapper) return;
    this.wrappers.delete(listener);
    this.port.off("message", wrapper);
  }
}

const parentPort = (process as NodeJS.Process & { parentPort?: ElectronParentPort }).parentPort;
if (!parentPort) throw new Error("UTILITY_PARENT_PORT_UNAVAILABLE");
const port = new ParentPortAdapter(parentPort);

try {
  const dataRoot = process.env.OH_MY_BUG_HOME ?? "";
  const useDemoAgent = process.env.OH_MY_BUG_INTERNAL_E2E_AGENT_MODE === "demo";
  const application = createRuntimeApplication(
    { dataRoot },
    useDemoAgent,
    Number(process.env.OH_MY_BUG_INTERNAL_E2E_AGENT_DELAY_MS ?? "0"),
    process.env.OH_MY_BUG_INTERNAL_E2E_AGENT_UNAVAILABLE_ONCE === "true",
  );
  await application.runtime.start();
  const server = createRuntimeServer(application.service, port);
  port.postMessage({ kind: "ready" });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await application.service.shutdown({});
  };
  process.once("disconnect", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
} catch {
  port.postMessage({ kind: "runtime-error", message: "RUNTIME_START_FAILED" });
  process.exitCode = 1;
}
