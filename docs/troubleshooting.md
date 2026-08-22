# 故障排查

先执行：

```bash
pnpm doctor
```

Doctor 检查 Node.js、pnpm、Codex 登录、Chromium、Desktop 构建、Runtime package graph、Storage 媒体资源、数据目录和 SQLite。打包后执行：

```bash
pnpm doctor:package -- "--app=out/Oh My Bug-darwin-arm64/Oh My Bug.app"
```

该命令 fail closed 校验 renderer、main、preload、Runtime entry/protocol、Core、Agent、全部内置 Integration、Storage、媒体辅助文件、Codex 二进制、MediaInfo WASM 和 Chromium。

## Desktop 无法启动

- 源码开发需要 Node.js 22+；打包后的应用不需要另装 Node。
- 执行 `pnpm exec playwright install chromium` 安装证据解码所需浏览器。
- 检查 `OH_MY_BUG_HOME` 的父目录可写。
- 未签名的本机构建需在 Finder 右键“打开”；不要全局关闭 Gatekeeper。
- 关闭窗口只是隐藏应用，请从菜单栏图标重新打开。

## Codex 或 Repair 失败

- 运行 `codex login status`。
- 确认 Project 路径仍是可访问的本机目录，项目所需依赖已准备好。
- 普通 `ASSESSMENT_FAILED` 或 `REPAIR_FAILED` 可以从 Issue 详情重试。
- `AGENT_SESSION_UNAVAILABLE` 表示原 provider 会话不存在。系统不会静默换会话；检查 Issue 上下文后点击“重建 Agent 会话”。
- 展开“Agent 活动”查看持久化的阶段与会话重建事件；内部思维过程不会作为证据展示。

## Integration 不健康

Settings 显示 `stopped | connecting | connected | backoff`、最后错误和下次重试时间。重新保存 Project 配置或 Secret patch 会刷新对应 Integration；单个插件失败不会阻止 Manual 或其他 Project。

## 证据不可用

系统只接受真实可解码的 PNG/JPEG/WebP 截图或 WebM/MP4 录屏。看到“证据文件不可用”时不要批准 Delivery，应填写反馈让 Agent 继续 Repair。证据位于 `<OH_MY_BUG_HOME>/evidence/issues/<issue-id>/repairs/<iteration>`，协议只通过 `evidenceId` 读取。
