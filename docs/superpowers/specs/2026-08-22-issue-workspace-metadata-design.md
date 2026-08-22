# Issue Workspace 元数据与详情栏布局设计

日期：2026-08-22

## 目标

- 当 Issue 使用 Git Worktree 且已经创建分支时，在右侧详情栏显示当前分支。
- 在分支名旁显示紧凑的 `Worktree` 标签。
- 没有分支时不渲染分支条目，也不显示占位文案。
- 详情栏标题在侧栏滚动时保持吸顶固定。
- Agent 活动中的命令详情占满侧栏内容区域的可用宽度。

## 数据边界

新增只读的 `IssueWorkspaceInfo` 查询，返回：

- `providerId`：创建当前 workspace 的 provider。
- `status`：持久化 workspace binding 的状态。
- `branch`：可选的当前分支名。

该信息属于运行环境状态，不加入核心 Issue 模型。Runtime 通过已有 workspace binding 找到 provider，再由 provider 描述对应 workspace。Git Worktree provider 从已持久化的 workspace state 读取分支；本机目录不返回分支。

查询结果通过 Runtime 协议、Desktop bridge 和 Web transport 传到界面。选择或刷新 Issue 时同步刷新 workspace 信息。读取失败不阻塞 Issue 主内容，界面隐藏分支条目。

## Provider 扩展

Workspace provider 增加可选的只读描述能力，用于返回通用 workspace 展示信息。Git provider 返回当前分支；Local provider无需实现。Runtime 不直接读取 Git provider 的私有存储，也不通过 `projectPath` 临时执行 Git 命令。

这样可以保持模块边界，并确保应用刷新或重启后仍能恢复分支显示。

## 界面

右侧 Issue 详情栏在“项目”条目之后条件渲染“分支”条目：

- 分支名使用等宽字体并允许在窄侧栏中安全截断。
- 分支名右侧显示 `Worktree` 标签。
- `branch` 缺失时不渲染整个条目。

详情栏标题使用侧栏内部的 sticky header，位于滚动内容之上并保持不透明背景和底部分隔线。

Agent 活动的详情区域与事件内容列同宽；`details` 和 `pre` 设置 `width: 100%`、`min-width: 0` 和适当的 box sizing。长命令或输出在 `pre` 内换行，超高内容继续使用内部滚动。

## 错误处理

- Issue 不存在时沿用现有 API 错误。
- Workspace binding 不存在时返回无 workspace 信息，不作为错误。
- Provider 不可用或描述失败时返回已有 binding 基本信息，但不返回分支；Issue 页面仍可正常使用。
- Browser 开发预览快照携带 Issue workspace 信息，保证 localhost 样式验收与桌面应用一致。

## 测试与验收

- Module API：provider 描述契约。
- Git provider：READY workspace 可从持久化 state 恢复当前分支。
- Runtime：有 Git binding 返回分支；Local 或无 binding 不返回分支；重建 Runtime 后仍可读取。
- Desktop transport：workspace 查询贯通 bridge 与浏览器开发预览。
- Web UI：有分支时显示分支和 `Worktree` 标签，无分支时不显示条目。
- CSS/浏览器：787×756 下滚动详情栏，标题保持固定；命令详情占满内容宽度且不溢出；控制台无新增错误。

## 非目标

- 不允许在 Issue 页面切换或编辑分支。
- 不新增分支复制、打开终端或打开目录操作。
- 不为本机目录伪造“当前分支”或“未创建分支”占位。
- 不改变 workspace 创建、发布或释放流程。
