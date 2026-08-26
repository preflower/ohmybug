# ASAR Hidden Temporary Path Compatibility Design

## Problem

Codex runs commands with `TMPDIR`, `TMP`, and `TEMP` set to an Issue-owned hidden directory named `.oh-my-bug-tmp-*`. The desktop packaging fixture creates its ASAR source tree below that directory. `@electron/asar` 3.4.1 applies the configured `unpack` glob to absolute filenames with minimatch's default dot-directory behavior, so the current path-bearing glob does not match files whose absolute path crosses a hidden directory.

This leaves the Codex executable and `MediaInfoModule.wasm` inside `app.asar` instead of `app.asar.unpacked`, causing four cascading packaged-runtime test failures.

## Decision

Define one exported ASAR unpack pattern in `apps/desktop/scripts/packaged-runtime.ts` and use it from both Electron Forge and the archive fixture. The pattern will match required runtime assets by basename rather than by parent path:

```ts
"{*.node,*.wasm,*.dylib,*.so,*.dll,*.exe,codex}"
```

`@electron/asar` uses `matchBase: true`, so a slash-free pattern matches the basename and is unaffected by hidden ancestor directories. This keeps native modules, WASM, platform libraries, Windows executables, and the extensionless Unix Codex binary unpacked.

## Alternatives Considered

1. Rename the private temporary directory to remove the leading dot. Rejected because hidden Issue-owned temp directories are intentional, and any other hidden ancestor would reproduce the defect.
2. Force this test to use `/tmp`. Rejected because it would hide the real Agent execution condition instead of making packaging path-independent.
3. Patch `@electron/asar` to enable `dot: true`. Rejected as a broader dependency patch when a stable public unpack pattern can express the required behavior.

## Testing

Add a regression that creates an archive fixture below an explicit `.hidden` directory and verifies the Codex binary and MediaInfo WASM are marked unpacked and exist physically in `app.asar.unpacked`. Run the focused test under an Agent-style hidden `TMPDIR`, then run the full desktop suite and type checking.

