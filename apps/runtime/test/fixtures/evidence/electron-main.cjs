const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 640, height: 480, show: true });
  void window.loadFile(path.join(__dirname, "electron.html"));
});
app.on("window-all-closed", () => app.quit());
