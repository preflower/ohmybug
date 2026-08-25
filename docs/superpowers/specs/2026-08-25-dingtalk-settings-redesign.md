# DingTalk 配置页简化与统一保存设计

日期：2026-08-25

## 背景

Oh My Bug 已通过 `@oh-my-bug/integration-dingtalk` 使用 DingTalk Stream 接收机器人消息。当前配置页直接平铺插件 Manifest 中的技术字段，并把普通项目配置与 Integration 凭证暴露为两个独立保存动作。这造成三个问题：

1. 用户无法判断哪些字段是连接必需项，哪些只是过滤或归并策略。
2. `mention`、`threadKeyField` 等实现细节占据主要表单层级。
3. “保存项目”与“保存 DingTalk 凭证”泄漏了 SQLite 和系统钥匙串的存储边界，形成两个互相竞争的保存心智模型。

本设计在保留插件化、密钥隔离和现有 Runtime 生命周期的前提下，简化 DingTalk 配置并提供一个可信的“保存更改”操作。

## 目标

- 普通用户默认只处理应用凭证和允许接收消息的群聊。
- 群白名单保持必填，避免机器人被加入其他群后自动扩大输入范围。
- 不再要求用户配置机器人称呼；DingTalk 事件中的 `isInAtList` 是 @ 机器人的判断依据。
- 关键词过滤与消息归并进入默认折叠的高级设置。
- 项目配置和 Integration 凭证通过一次用户操作保存。
- SQLite 与系统钥匙串继续分开存储，并在跨存储写入失败时回滚。
- Manifest 展示能力可被 Sentry 和未来 Integration 复用，不在 Desktop 中增加 DingTalk 专属页面分支。

## 非目标

- 本次不实现向 DingTalk 回复处理进度或结果。
- 本次不增加“允许所有群聊”模式。
- 本次不自动发现或选择 DingTalk 群聊。
- 本次不改变 Issue 去重、归并或 Agent 编排规则。
- 本次不删除已经存储的 DingTalk 凭证。

## 已确认的视觉方向

配置页延续 Oh My Bug 的紧凑暗色工程工具风格：克制的中性色表面、少量蓝紫色交互强调、真实状态使用语义色、无渐变和装饰性卡片。

页面结构如下：

1. 顶部显示 `DingTalk`、用途说明、启用开关和连接状态。
2. “应用凭证”展示 Client ID 与 Client Secret。已保存的值只显示“已配置”，点击“替换”后才进入编辑状态。
3. “接收规则”展示群聊 ID 白名单，可添加和删除条目。
4. “高级设置”默认折叠，包含消息关键词与消息归并字段。
5. 固定底部操作栏只提供“取消”和“保存更改”。

已确认的 ImageGen 参考稿：

`/Users/starrblink/.codex/generated_images/01a03786-2f08-7cf1-ad4f-88f12a432f43/exec-089209b0-9558-4158-9a1b-36ca077c2330.png`

参考稿用于确定信息层级、密度和交互位置。实现必须使用现有组件和设计令牌，不把位图作为产品资产。

## Manifest 展示模型

`IntegrationPluginManifest` 增加可选的页面说明和分组定义。现有插件未提供这些字段时继续按当前平铺方式渲染。

采用以下数据形状：

```ts
interface IntegrationSection {
  id: string;
  label: string;
  description?: string;
  summary?: { label: string; value: string };
  collapsed?: boolean;
}

interface IntegrationPluginManifest {
  id: string;
  name: string;
  icon?: "plug" | "messageCircle" | "webhook";
  description?: string;
  sections?: IntegrationSection[];
  configFields: ConfigField[];
  secretFields: SecretField[];
}

interface IntegrationFieldPresentation {
  section?: string;
  placeholder?: string;
  addLabel?: string;
}
```

`icon`、section `summary`、字段 `section` / `placeholder` 与数组字段 `addLabel` 都是可选的通用展示属性。若字段引用不存在的 section，Manifest 校验失败。分组顺序由 `sections` 决定，未分组字段最后按 Manifest 原始顺序显示。

这次不加入通用条件表达式或任意 UI schema。DingTalk 始终要求群白名单，因此没有需要条件显示的“允许全部群聊”选项。YAGNI 保持 Manifest 扩展边界清晰。

## DingTalk 字段

新 Manifest 使用以下字段：

| 字段 | 分组 | 必填 | 页面文案 | 行为 |
| --- | --- | --- | --- | --- |
| `clientId` | `credentials` | 是 | Client ID | 已配置时隐藏值，可选择替换 |
| `clientSecret` | `credentials` | 是 | Client Secret | 已配置时隐藏值，可选择替换 |
| `conversationIds` | `rules` | 是 | 群聊 ID | 至少一个；trim 后不能为空或重复 |
| `messageRule` | `advanced` | 否 | 消息关键词 | 非空时才写入配置 |
| `threadKeyField` | `advanced` | 否 | 消息归并字段 | 非空时才写入配置 |

`mention` 不再出现在 Manifest 中。适配器以 `isInAtList === true` 判断消息是否 @ 机器人，并清理消息开头的 @ 文本后生成 `data.content`。清理逻辑只移除开头的机器人 mention，不移除正文中的其他 @ 内容。

为兼容旧项目，DingTalk 配置校验器暂时允许读取已有 `mention`，但不再要求它。Project Form 从 Manifest 声明字段构造下一次保存的配置，因此旧 `mention` 会在用户下次成功保存项目时被移除。迁移期间旧值不影响消息接收。

## 页面状态与交互

### 凭证

- `secretConfigured[key] === true` 且用户未选择替换时，控件显示“已配置”和“替换”，不渲染原值。
- 点击“替换”后显示空密码输入框。空值表示不修改现有凭证。
- 新项目可在第一次保存前输入凭证；不再要求先保存项目以获得 ID。
- 禁用 Integration 不删除凭证。再次启用时继续使用已经配置的值。

### 群白名单

- 启用 DingTalk 时至少需要一个非空群聊 ID。
- 添加操作在列表尾部插入一个空输入框并聚焦。
- 删除最后一个条目后，启用状态下显示字段错误，不自动关闭 Integration。
- 保存前对每个值执行 `trim`，按规范化后的值检查重复。

### 高级设置

- 默认折叠。
- 展开状态只属于页面会话，不写入项目配置。
- `messageRule` 和 `threadKeyField` 的空白值规范化为缺失字段。

### 脏状态

普通配置、启用状态或凭证草稿变化都会将页面标记为“有未保存的更改”。保存成功后显示“所有更改已保存”。点击“取消”会放弃本次未保存的普通配置与凭证草稿，并返回项目列表；它不会撤销此前已经成功保存的内容。

## 连接状态

页面从现有 `integrationHealth()` 输出读取 `${projectId}:dingtalk`：

- `connected`：已连接。
- `connecting`：正在连接。
- `backoff`：连接失败，正在重试；展示脱敏后的 `lastError` 和可用的 `nextRetryAt`。
- `stopped` 或 Integration 未启用：已停用。

保存状态与连接状态必须分开。配置和凭证已成功持久化但 Stream 无法连接时，页面显示“所有更改已保存”以及“连接失败，正在重试”，不得把连接失败伪装成保存失败，也不得显示“已连接”。

## 统一保存协议

新增 `saveProjectSettings` Runtime 操作。输入是严格判别联合：

- 创建：`{ mode: "create", project, secretPatches }`
- 更新：`{ mode: "update", id, expectedRevision, project, secretPatches }`

`project` 包含现有 create/update 共享的项目、Workspace 和 Integration 普通配置字段；`secretPatches` 的形状为 `Record<pluginId, Record<secretKey, string | null>>`。空字符串不进入协议，表示不修改；`null` 保留为删除凭证的协议能力，但本次 UI 不提供删除入口。

保存顺序：

1. 规范化项目字段和 DingTalk 配置。
2. 校验项目、Workspace、Integration Manifest 字段和凭证 patch。
3. 为新项目生成项目 ID，并为待写凭证生成稳定的 Keychain reference。
4. 读取所有受影响凭证的旧值，形成回滚快照。
5. 写入或替换 Keychain 凭证。
6. 在 SQLite 事务中创建或更新项目、Integration secret refs 和 Workspace 配置。
7. SQLite 写入失败时，按回滚快照恢复 Keychain；回滚失败返回 `PROJECT_SETTINGS_ROLLBACK_FAILED`。
8. 持久化成功后刷新对应项目的 Integration 生命周期。
9. 返回最新 ProductProject；凭证仍只通过 `secretConfigured` 布尔值暴露。

必须先完成全部静态校验再写 Keychain。Keychain 写入失败时不允许修改 SQLite。SQLite 写入成功后发生的 Stream 连接失败不回滚配置；它通过 Integration health 表达。

现有 `setIntegrationSecrets` 操作可以保留为兼容入口，但 Project Form 不再直接调用它。所有项目设置 UI 都使用新的统一保存操作。

## 错误处理

- 字段校验错误显示在对应字段下方，并将焦点移到第一个错误字段。
- 持久化失败显示在固定底部操作栏上方，保留用户输入和凭证草稿。
- `PROJECT_SETTINGS_ROLLBACK_FAILED` 使用明确的高优先级错误文案，提示用户配置状态可能需要重新加载确认。
- DingTalk Stream 错误继续使用现有 secret redaction；页面不得展示 Client ID、Client Secret、access token 或 session webhook。
- 保存进行中禁用重复提交，但页面仍可滚动和阅读。
- revision 冲突不覆盖较新的项目数据；提示重新加载后再保存。

## 可访问性与响应式

- 分组使用语义 heading；高级设置使用可键盘操作的 disclosure 控件并暴露展开状态。
- 每个密钥的“替换”按钮拥有包含字段名称的 accessible name。
- 连接状态同时使用文本和图形，不只依赖颜色。
- 错误字段通过 `aria-describedby` 关联错误文本。
- 保存结果通过 polite live region 宣告；需要立即处理的持久化错误使用 alert。
- 窄窗口下字段改为单列，底部操作栏保持可见且不覆盖表单内容。
- 实现同时使用现有暗色和亮色设计令牌，禁止在组件中硬编码主题颜色。

## 测试策略

### Core 与协议

- Manifest 的 description、sections、field section/placeholder schema 测试。
- 旧 Manifest 无展示字段时的兼容测试。
- 不存在的 section reference 被拒绝。
- 统一保存操作的输入输出 schema 测试。

### DingTalk 插件

- 启用时只要求凭证 refs、至少一个 conversation ID。
- `mention` 缺失时消息仍可被接收。
- `isInAtList !== true` 的消息被拒绝。
- 开头机器人 mention 被移除，正文其他 @ 内容保留。
- 旧配置中的 `mention` 可读取但不影响新行为。
- conversation ID trim、空值和重复值校验。

### Runtime

- 新建项目和凭证一次保存成功。
- 更新普通配置和替换凭证一次保存成功。
- Keychain 写入失败时 SQLite 不变。
- SQLite 写入失败时 Keychain 恢复旧值。
- Keychain 回滚失败返回稳定错误且不报告成功。
- revision 冲突不覆盖已有配置。
- 保存成功但 Stream 连接失败时返回已保存项目，并通过 health 报告 backoff。

### Desktop

- Manifest 分组顺序和高级设置默认折叠。
- 已配置凭证显示状态，点击替换后出现空密码输入。
- 页面只有一个提交型“保存更改”按钮，不存在 Integration 级保存按钮。
- 普通字段和凭证变更共用脏状态。
- 保存成功、字段失败、持久化失败和连接失败的状态文案互不混淆。
- 取消放弃未保存状态、清除凭证草稿并返回项目列表。
- 暗色、亮色、窄窗口、200% zoom 和键盘操作检查。
- 使用确定性本地数据生成截图，与已确认 ImageGen 稿的信息层级和布局约束对照验证。

## 实施边界

预计涉及：

- `packages/core/src/integration/plugin.ts`
- `packages/integration-dingtalk/src/plugin.ts`
- `packages/integration-dingtalk/src/dingtalk-adapter.ts`
- `apps/runtime/src/protocol/*`
- `apps/runtime/src/service.ts`
- `apps/desktop/src/web/api/*`
- `apps/desktop/src/web/projects/*`
- `apps/desktop/src/web/styles/global.css`
- 对应单元、协议、组件和端到端测试

不新增 DingTalk 专属 Desktop 页面组件。可以新增通用 Integration section、secret replacement 和 save-state 小组件，以保持文件职责清晰。
