import { contextBridge, ipcRenderer } from "electron";

import { createDesktopApi, type RendererIpc } from "./desktop-api.js";

const ipc: RendererIpc = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener)
};

contextBridge.exposeInMainWorld("ohMyBug", createDesktopApi(ipc));
