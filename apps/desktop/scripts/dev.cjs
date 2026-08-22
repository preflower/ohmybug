/* eslint-disable no-undef, typescript/no-require-imports */

const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const { api } = require("@electron-forge/core");

const ELECTRON_RESTART_EVENT = "oh-my-bug:restart-electron";
const repositoryRoot = resolve(__dirname, "../../..");

function createElectronRestartController(options) {
  const electronExecutable = options.initialChild.spawnfile;
  const electronArguments = options.initialChild.spawnargs.slice(1);
  let currentChild = options.initialChild;
  let disposed = false;
  let restarting = false;
  let queued = false;

  const reportError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    options.errorOutput.write(`ELECTRON_DEV_RESTART_FAILED:${message}\n`);
  };
  const attachReplacement = (child) => {
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      dispose();
      options.exit(code);
    };
    child.once("error", (error) => {
      reportError(error);
      finish(1);
    });
    child.once("exit", (code, signal) => {
      if (child.restarted || disposed) return;
      finish(code ?? (signal ? 1 : 0));
    });
  };
  const restart = () => {
    if (disposed) return;
    if (restarting) {
      queued = true;
      return;
    }
    restarting = true;
    queued = false;
    const previousChild = currentChild;
    previousChild.restarted = true;
    previousChild.once("exit", () => {
      if (disposed) return;
      try {
        currentChild = options.spawnElectron(electronExecutable, electronArguments, {
          cwd: options.repositoryRoot,
          env: options.environment,
          stdio: "inherit",
        });
        attachReplacement(currentChild);
        options.output.write("✔ Restarting Electron app\n");
      } catch (error) {
        reportError(error);
        dispose();
        options.exit(1);
      } finally {
        restarting = false;
        if (queued) restart();
      }
    });
    previousChild.kill("SIGTERM");
  };
  const stopChild = () => {
    if (!currentChild.killed) currentChild.kill("SIGTERM");
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.events.off(ELECTRON_RESTART_EVENT, restart);
    options.events.off("exit", stopChild);
  };

  options.events.on(ELECTRON_RESTART_EVENT, restart);
  options.events.once("exit", stopChild);
  return { dispose };
}

function parseDevelopmentArguments(args) {
  const separator = args.indexOf("--");
  const forgeArgs = separator === -1 ? args : args.slice(0, separator);
  return {
    appArgs: separator === -1 ? [] : args.slice(separator + 1),
    enableLogging: forgeArgs.includes("--enable-logging"),
    help: forgeArgs.includes("--help") || forgeArgs.includes("-h"),
    inspect: forgeArgs.includes("--inspect-electron"),
    inspectBrk: forgeArgs.includes("--inspect-brk-electron"),
    runAsNode: forgeArgs.includes("--run-as-node") || forgeArgs.includes("-n"),
  };
}

async function startDesktopDevelopment(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const output = options.output ?? process.stdout;
  const parsed = parseDevelopmentArguments(args);
  if (parsed.help) {
    output.write("Usage: electron-forge-start [options] [dir]\n");
    return { dispose() {} };
  }

  environment.OMB_VITE_DEV = "1";
  delete environment.npm_config__jsr_registry;
  const start = options.start ?? ((startOptions) => api.start(startOptions));
  const startOptions = {
    args: parsed.appArgs,
    dir: repositoryRoot,
    interactive: false,
  };
  if (parsed.enableLogging) startOptions.enableLogging = true;
  if (parsed.inspect) startOptions.inspect = true;
  if (parsed.inspectBrk) startOptions.inspectBrk = true;
  if (parsed.runAsNode) startOptions.runAsNode = true;

  const initialChild = await start(startOptions);
  const replacementEnvironment = { ...environment };
  if (parsed.enableLogging) {
    replacementEnvironment.ELECTRON_ENABLE_LOGGING = "true";
    replacementEnvironment.ELECTRON_ENABLE_STACK_DUMPING = "true";
  }
  if (parsed.runAsNode) {
    replacementEnvironment.ELECTRON_RUN_AS_NODE = "true";
  } else {
    delete replacementEnvironment.ELECTRON_RUN_AS_NODE;
  }
  return createElectronRestartController({
    environment: replacementEnvironment,
    errorOutput: options.errorOutput ?? process.stderr,
    events: options.events ?? process,
    exit: options.exit ?? ((code) => process.exit(code)),
    initialChild,
    output,
    repositoryRoot,
    spawnElectron: options.spawnElectron ?? spawn,
  });
}

async function runDesktopDevelopment(options = {}) {
  try {
    await (options.startDesktopDevelopment ?? startDesktopDevelopment)();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    (options.errorOutput ?? process.stderr).write(`${message}\n`);
    (options.exit ?? ((code) => process.exit(code)))(1);
  }
}

module.exports = {
  ELECTRON_RESTART_EVENT,
  createElectronRestartController,
  runDesktopDevelopment,
  startDesktopDevelopment,
};

if (require.main === module) void runDesktopDevelopment();
