# Oh My Bug

Oh My Bug 是本机运行的 Electron 软件改动处理系统，支持 Bug 修复和 Feature 实现。Manual、Sentry、DingTalk 等 Integration 先把外部输入适配成统一的 `IntegrationInput { rawData, data }`；Runtime 负责去重、Issue 状态机、Agent 会话、人工门禁和持久化；Codex Agent 在同一会话中完成判断、实现与验证。

核心流程有两次明确确认：

1. Agent 生成 Assessment。无论结论是 `BUG`、`FEATURE`、`NOT_A_BUG` 还是 `UNCERTAIN`，都先等待人工确认；系统不会根据 AI 判断自行关闭 Issue。
2. `BUG` 或 `FEATURE` 经确认后进入实现循环。只有截图或录屏能成为 Delivery 的验收证据；证据通过结构检查后仍需人工批准，批准后 Bug 完成为 `COMPLETED / FIXED`，Feature 完成为 `COMPLETED / IMPLEMENTED`。`CLOSED` 仅表示人工确认的 `NOT_A_BUG` 或 `DUPLICATE` 关闭结果。

## Monorepo

```text
apps/
  desktop/                 Electron 生命周期、IPC 和展示容器
  runtime/                 Runtime 协议、编排、Worker、Integration 生命周期
packages/
  core/                    Issue、状态机、端口与通用契约
  agent-codex/             Codex Agent Adapter
  integration-manual/      Manual Adapter
  integration-sentry/      Sentry Adapter
  integration-dingtalk/    DingTalk Adapter
  storage/                 SQLite、Keychain 与截图/录屏证据
```

具体架构与流程图见 [docs/architecture.md](docs/architecture.md)。

## 开发与打包

需要 Node.js 22+、pnpm、Git 和已登录的 Codex：

```bash
pnpm install
pnpm exec playwright install chromium
pnpm doctor
pnpm dev
```

`pnpm dev` 通过 Vite 启动 Electron 开发窗口，并使用真实的本机 Runtime 与数据目录。`pnpm dev:web` 启动只读的浏览器样式预览：页面打开或刷新时从同一个 `OH_MY_BUG_HOME` 读取一次 Projects 与 Issues 快照，不会把浏览器操作写回 Runtime；空数据目录会使用内置展示数据。应用不监听生产 HTTP 端口，快照接口只存在于 Vite 开发服务器：

```bash
pnpm dev:web
pnpm test:e2e
```

生成并验证 macOS 应用：

```bash
pnpm package
pnpm doctor:package -- "--app=out/Oh My Bug-darwin-arm64/Oh My Bug.app"
pnpm test:e2e:electron
```

## 数据与安全边界

数据默认位于 `~/.oh-my-bug`，可用 `OH_MY_BUG_HOME` 指向其他目录。SQLite 保存 Project、Issue、Integration Input、事件和 Agent session；截图与录屏证据位于同一数据根目录。Integration 密钥值只进入系统 Keychain，DTO 和事件只返回是否已配置。

Renderer 只访问冻结的命名 Runtime protocol API，没有 Node、Electron、文件系统、Git 或任意 IPC 权限。Runtime 运行在 Utility Process；关闭窗口只隐藏 UI，从菜单栏退出才会完整停止 Integration、Worker 和数据库。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:desktop
pnpm test:e2e
pnpm package
pnpm test:e2e:electron
```

更多信息见 [配置](docs/configuration.md)、[Agent 边界](docs/agent-core.md) 与 [故障排查](docs/troubleshooting.md)。
