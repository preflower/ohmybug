/// <reference types="vite/client" />

import type { DesktopApi } from "./electron/desktop-api.js";

declare global {
  interface Window {
    ohMyBug?: Readonly<DesktopApi>;
  }
}
