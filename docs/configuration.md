# 配置说明

## 进程环境

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `OH_MY_BUG_HOME` | `~/.oh-my-bug` | Runtime SQLite 与可视化证据的根目录。 |

应用不会隐式读取 `.env`。生产 Desktop 不监听 HTTP 端口；它使用 Electron Utility Process 启动 Runtime，并通过 Runtime 自有协议通信。

## Project

每个 Project 配置本机目录、Project key、可选项目指令、Agent 插件，以及可选的 install/test/start/acceptance URL。这些命令作为项目上下文交给 Agent。

当前内置 Agent 插件为 `codex`，对外提供 Assessment、Repair、Session 与 Cancel。模型、线程和执行细节由插件内部管理，不作为 Project 通用配置字段。

每个 Project 还可在“权限”中选择 Codex 的运行方式：

- 请求批准：保持工作区沙箱，需要更高权限时进入应用现有的人工授权流程；在 Terminal 中打开时使用 `workspace-write` 与 `on-request`。
- 帮我批准：保持工作区沙箱，由 Codex 自动审核高权限请求；在 Terminal 中打开时传递 `--approve-for-me`。
- 完全访问权限：跳过批准和沙箱限制，仅应为可信项目启用；选择时需要额外确认。

权限设置保存在本机 Project 数据中，并在后台 Codex 线程及 Terminal 恢复会话时动态传递。它不会创建或修改项目仓库中的 `.codex/config.toml`。
证据采集也遵守相同设置，不再隐式获得主机与网络的完全访问权限。

## Integration plugins

Desktop 从 Runtime 读取插件清单，再根据有限字段类型 `string | string[] | number | boolean` 和可选展示分组动态生成表单。新增内置 Integration 只需要新增包、Runtime 依赖和 registry 条目，不需要修改 Desktop 表单。

- Sentry：启用时 `organization`、`project` 和 Auth token 必填；`environment`、`query` 可选。Query 留空时 Sentry 默认使用 `is:unresolved`。Auth token 不是 DSN，最小权限建议为 `event:read`。保存项目后可使用“测试已保存配置”验证访问权限；未保存的字段和 Token 草稿不会参与测试。
- DingTalk：必填项只有 Client ID、Client Secret 和至少一个群聊 ID。`messageRule`（消息关键词）与 `threadKeyField`（消息归并字段）位于默认折叠的高级设置中，均为可选。机器人称呼不需要配置；只有 DingTalk 标记为已 @ 机器人的消息才会进入系统。
- Manual：无需 Project 配置，通过 Runtime protocol 提交 `content` 和可选 `summary/context`。

一个 Integration 可以声明多个 Secret key。每个 key 独立存入系统 Keychain，普通项目配置存入 SQLite；这些存储位置不会暴露成多个保存按钮。项目设置页的“保存更改”会一次提交普通配置和凭证草稿，任一写入失败都会回滚本次变更。协议响应只返回 `secretConfigured` 布尔值，不返回 Secret 内容。

### DingTalk 接入

1. 在 DingTalk 应用凭证中取得 Client ID 与 Client Secret。
2. 在项目设置中打开 DingTalk，填写两个凭证。
3. 添加允许创建 Issue 的群聊 ID；该白名单至少保留一项，避免机器人加入其他群后自动扩大接收范围。
4. 如需过滤消息或归并同一讨论，再展开“高级设置”。
5. 点击页面底部唯一的“保存更改”。保存成功后凭证输入会恢复为“已配置”，连接结果单独显示为“已连接”“正在连接”或“连接失败”。

已保存的凭证默认不渲染输入框；点击对应的“替换”后才会出现空密码输入。空值不会覆盖现有凭证。旧项目中的 `mention` 配置仍可读取，但不再参与接收判断，并会在下一次成功保存时从普通配置中移除。

## Desktop 进程

Renderer 只访问冻结的命名 API。Runtime、Integration manager、Agent registry 与 Storage 位于独立 Utility Process。关闭窗口保留后台任务；菜单栏“退出”会停止订阅、Runtime 和数据库。
