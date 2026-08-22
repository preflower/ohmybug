# 配置说明

## 进程环境

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `OH_MY_BUG_HOME` | `~/.oh-my-bug` | Runtime SQLite 与可视化证据的根目录。 |

应用不会隐式读取 `.env`。生产 Desktop 不监听 HTTP 端口；它使用 Electron Utility Process 启动 Runtime，并通过 Runtime 自有协议通信。

## Project

每个 Project 配置本机目录、Project key、可选项目指令、Agent 插件，以及可选的 install/test/start/acceptance URL。这些命令作为项目上下文交给 Agent。

当前内置 Agent 插件为 `codex`，对外提供 Assessment、Repair、Session 与 Cancel。模型、线程和执行细节由插件内部管理，不作为 Project 通用配置字段。

## Integration plugins

Desktop 从 Runtime 读取插件清单，再根据有限字段类型 `string | string[] | number | boolean` 动态生成表单。新增内置 Integration 只需要新增包、Runtime 依赖和 registry 条目，不需要修改 Desktop 表单。

- Sentry：`organization`、`project` 必填，`environment`、`query` 可选；Secret key 为 `token`。
- DingTalk：`conversationIds` 是字符串数组，`mention` 必填，`messageRule`、`threadKeyField` 可选；Secret keys 为 `clientId`、`clientSecret`。
- Manual：无需 Project 配置，通过 Runtime protocol 提交 `content` 和可选 `summary/context`。

一个 Integration 可以声明多个 Secret key。每个 key 独立存入系统 Keychain，但 Desktop 以一次 Integration 级 patch 提交；任一写入失败会回滚整批。协议响应只返回 `secretConfigured` 布尔值，不返回 Secret 内容。

## Desktop 进程

Renderer 只访问冻结的命名 API。Runtime、Integration manager、Agent registry 与 Storage 位于独立 Utility Process。关闭窗口保留后台任务；菜单栏“退出”会停止订阅、Runtime 和数据库。
