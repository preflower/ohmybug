import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
spawn(process.execPath, [join(fixtureDirectory, "grandchild-server.mjs")], {
  env: process.env,
  stdio: "ignore",
});

setInterval(() => undefined, 1_000);
