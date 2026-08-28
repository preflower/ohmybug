# Oh My Bug

Oh My Bug 是本机运行的 Electron 软件改动处理系统，支持 Bug 修复和 Feature 实现。Manual、Sentry、DingTalk 等 Integration 先把外部输入适配成统一的 `IntegrationInput { rawData, data }`；Runtime 负责去重、Issue 状态机、Agent 会话、人工门禁和持久化；Codex Agent 在同一会话中完成判断、实现与验证。

Assessment 与 Delivery 仍有两次明确确认，所有人工暂停都统一为 `REVIEW_REQUIRED + ReviewRequest`：

1. Agent 生成 Assessment。无论结论是 `BUG`、`FEATURE`、`NOT_A_BUG` 还是 `UNCERTAIN`，都先等待人工确认；系统不会根据 AI 判断自行关闭 Issue。
2. `BUG` 或 `FEATURE` 经确认后进入实现循环。只有截图或录屏能成为 Delivery 的验收证据；证据通过结构检查后仍需人工批准，批准后 Bug 完成为 `COMPLETED / FIXED`，Feature 完成为 `COMPLETED / IMPLEMENTED`。`CLOSED` 仅表示人工确认的 `NOT_A_BUG` 或 `DUPLICATE` 关闭结果。

Git 项目启用“完成后合并到基线分支”时，Codex 会在隔离的 Issue worktree 中基于每轮最新基线完成实现、合并、冲突处理、提交和验证。文本冲突以及能同时保留的业务改动由 AI 自行处理；只有基线与 Issue 要求的业务行为互斥时才请求人工选择。验收后的 commit 通过受保护的 fast-forward 发布到基线；如果基线再次前进，Runtime 会重新进入 Repair 验证，不会直接改写用户的 main 工作目录或覆盖其中无关的个人改动。

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

## 在 Terminal 中继续 Agent 会话

macOS 桌面版会由 Runtime 独占启动一个 Codex App Server。选中 Issue 后，可在右侧详情栏的“Agent 会话”旁点击“在 Terminal 中打开”，让 Terminal.app 连接到同一个 Codex thread。该入口只在 Codex Agent 已创建 provider session、Issue 工作区就绪且 App Server 可用时启用；浏览器样式预览不提供虚拟 socket，也不能启动 Terminal。

Terminal 会话沿用项目设置中的“请求批准 / 帮我批准 / 完全访问权限”，并把对应 CLI 参数附加到 `codex resume`。设置只保存在本机，不会修改项目仓库内的 Codex 配置。

如果 Runtime-owned turn 仍在运行，从 Terminal 输入的内容会 steer 同一个 active turn，Oh My Bug 仍只接收与自身 thread ID、turn ID 同时匹配的结果。之后由 Terminal 单独新建的 turn 不会替代 Runtime 正在等待的 turn，也不能越过 Assessment 或 Delivery 人工门禁。

打开或关闭 Terminal 只影响这个额外客户端，不会暂停、取消 Issue，也不会修改 Issue 状态或 revision。退出 Oh My Bug 时，Runtime 会停止它拥有的 App Server，并清理私有 Unix socket 与会话临时目录。这个入口当前仅支持 macOS Terminal.app。

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
