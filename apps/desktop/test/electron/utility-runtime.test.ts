import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("utility runtime", () => {
  it("boots inside Runtime while Desktop only points at its entry", () => {
    const runtimeEntry = resolve(import.meta.dirname, "../../../runtime/src/entry.ts");
    const desktopUtility = resolve(import.meta.dirname, "../../src/electron/utility.ts");
    const main = readFileSync(resolve(import.meta.dirname, "../../src/electron/main.ts"), "utf8");

    expect(existsSync(runtimeEntry)).toBe(true);
    expect(existsSync(desktopUtility)).toBe(false);
    expect(readFileSync(runtimeEntry, "utf8")).toContain("createRuntimeApplication");
    expect(readFileSync(runtimeEntry, "utf8")).toContain("application.runtime.start()");
    expect(main).toContain("../../../../node_modules/@oh-my-bug/runtime/src/entry.js");
  });
});
