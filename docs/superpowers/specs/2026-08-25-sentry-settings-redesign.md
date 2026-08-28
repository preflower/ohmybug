# Sentry 配置页重设计与已保存配置连接测试

日期：2026-08-25

## 背景

Oh My Bug ?! 已通过 `@oh-my-bug/integration-sentry` 轮询 Sentry Organization Issues API，并把事件转换为统一的 Integration Input。当前 Sentry 设置仍使用旧的平铺字段布局：Organization、Project、Environment、Query 与 Auth token 处于同一视觉层级，用户无法快速区分连接必需项和可选过滤项，也无法在保存后主动验证配置与权限。

DingTalk 配置页已经建立了可复用的 Integration 展示模式，包括页面说明、字段分组、折叠高级设置、密钥替换、真实健康状态和统一保存。本设计让 Sentry 复用同一套产品语言，并在不泄漏密钥、不绕过插件边界的前提下增加“测试已保存配置”。

## 目标

- 让 Organization、Project 和 Auth token 三项必填配置形成清晰的主要操作路径。
- 把 Environment 和 Query 收纳为默认折叠的可选过滤规则。
- 允许用户主动测试已经持久化的 Sentry 配置与访问权限。
- 测试成功时展示 Organization、Project 和测试时间，不展示容易误解的 Issue 数量。
- 测试失败时提供稳定、脱敏、可操作的错误说明。
- 保持 Desktop 与 Runtime 的 Integration 插件化边界，使未来插件可以复用连接测试能力。
- 延续项目现有的紧凑桌面设置风格、统一保存和 Keychain 密钥隔离。

## 非目标

- 不测试当前表单中尚未保存的配置或密钥草稿。
- 不实现 Sentry Organization、Project 或 Environment 的远程自动发现与下拉选择。
- 不展示或持久化 Issue 数量、Issue 内容或测试响应样本。
- 不支持自建 Sentry Endpoint；客户端继续使用 `https://sentry.io`。
- 不改变后台 Poller 的分页、水位线、重试或 Issue 接收逻辑。
- 不为 Sentry 编写 Desktop 专属配置页面或专属 Runtime operation。
- 不给 DingTalk 增加连接测试实现；本次只提供可供未来复用的通用能力。

## 已确认的设计方向

采用通用 Integration 测试能力：插件可以选择实现 `testConnection`，Runtime 负责定位本机项目、读取已保存配置和 Keychain 密钥并调用插件；Desktop 只提交本机项目 ID 与 Integration ID，渲染通用结果，不接触 Token 或 Sentry 专属请求细节。

页面属于 Product register。用户场景是工程师在桌面应用中配置外部问题来源，通常希望快速验证访问权限并继续处理项目，界面必须冷静、紧凑、明确。视觉使用 DESIGN.md 既定的暗色默认主题、克制的中性色表面、蓝紫色交互强调和真实语义状态色，并完整支持亮色主题。现有 DingTalk 设置页是主要页面锚点，Linear 的层级纪律和 Raycast 的紧凑反馈是交互锚点。

## 页面信息结构

### 页面头部

头部继续使用通用 Integration heading，包含：

- `Sentry` 标题；
- 用途说明：“从指定 Sentry 项目接收 Issue 和事件。”；
- 后台 Integration health，显示已停用、正在连接、已连接或连接失败并重试；
- 启用开关及“已启用 / 已停用”文本。

后台健康状态与手动连接测试结果是两个独立事实。一次手动测试成功不能覆盖 Poller 后续的连接失败；Poller 已连接也不能替代用户主动测试已保存配置的结果。

### 连接配置

“连接配置”是默认展开的主要分组，包含三项必填内容：

| 字段 | 配置键 | 展示与行为 |
| --- | --- | --- |
| Organization | `organization` | 接受 Sentry Organization ID 或 slug；提供简短说明和示例占位符。 |
| Project | `project` | 接受 Sentry Project ID 或 slug；说明它用于限制接收范围。 |
| Auth token | `token` | Secret；首次配置显示密码输入，已保存时只显示“已配置”和“替换”。 |

Auth token 的辅助文案明确说明它不是 DSN，并建议使用最小 `event:read` 权限。页面不回显已保存 Token，替换草稿在保存前不会参与连接测试。

### 连接验证

“连接验证”是默认展开的独立分组，包含：

- 当前测试来源说明：“仅使用已保存的配置和凭证。”；
- `测试已保存配置` 按钮；
- 测试中的进行状态；
- 最近一次当前页面会话内的成功或失败结果；
- 当表单存在未保存修改时的提示：“当前修改不会用于本次测试。”。

新项目在首次保存前禁用测试按钮，并显示“保存项目后可测试连接”。Integration 停用但已保存完整配置时仍允许测试，方便用户先验证后启用。测试连接不保存表单、不会清除脏状态，也不属于底部统一保存动作。

### 过滤规则

“过滤规则”默认折叠，包含：

| 字段 | 配置键 | 行为 |
| --- | --- | --- |
| Environment | `environment` | 可选；非空时限定事件环境。 |
| Query | `query` | 可选；使用 Sentry 搜索语法。 |

折叠摘要根据已编辑表单值显示接收范围。Environment 为空时显示“全部环境”；Query 为空时显示“未解决 Issue”，因为 Sentry Organization Issues API 在未传 Query 时默认使用 `is:unresolved`。摘要只帮助理解表单，不代表已保存或已测试状态。

### 底部操作

页面底部继续使用项目设置统一操作栏：

- `取消` 放弃未保存的普通配置与密钥草稿；
- `保存更改` 一次保存项目配置与 Keychain 密钥补丁；
- 手动测试按钮位于“连接验证”分组，不增加第二个保存按钮。

## Manifest 展示配置

Sentry Manifest 复用现有通用字段，不增加 Desktop 专属分支：

```ts
const manifest = {
  id: "sentry",
  name: "Sentry",
  icon: "sentry",
  description: "从指定 Sentry 项目接收 Issue 和事件。",
  sections: [
    {
      id: "connection",
      label: "连接配置",
      description: "用于定位项目并读取事件。",
    },
    {
      id: "validation",
      label: "连接验证",
      description: "仅使用已保存的配置和凭证。",
      connectionTest: true,
    },
    {
      id: "filters",
      label: "过滤规则",
      description: "限制进入 Oh My Bug ?! 的 Sentry Issue。",
      collapsed: true,
    },
  ],
  configFields: [
    {
      key: "organization",
      type: "string",
      label: "Organization",
      description: "Sentry Organization ID 或 slug。",
      placeholder: "acme",
      required: true,
      section: "connection",
    },
    {
      key: "project",
      type: "string",
      label: "Project",
      description: "Sentry Project ID 或 slug。",
      placeholder: "checkout",
      required: true,
      section: "connection",
    },
    {
      key: "environment",
      type: "string",
      label: "Environment",
      placeholder: "production",
      required: false,
      section: "filters",
    },
    {
      key: "query",
      type: "string",
      label: "Query",
      description: "留空时使用 Sentry 默认查询 is:unresolved。",
      placeholder: "is:unresolved level:error",
      required: false,
      section: "filters",
    },
  ],
  secretFields: [
    {
      key: "token",
      label: "Auth token",
      description: "需要 event:read 权限；请勿填写 DSN。",
      placeholder: "sntrys_…",
      required: true,
      section: "connection",
    },
  ],
};
```

`connectionTest` 是 Integration section 的可选通用展示能力。它只决定通用测试控件的位置，不携带请求或 Sentry 专属逻辑。Manifest 校验继续要求 section 引用存在，并应拒绝同一 Manifest 中多个 `connectionTest: true` 分组，避免一个页面出现重复测试入口。

过滤规则的动态摘要不能使用当前静态 `summary.value` 表达。`IntegrationSection.summary` 保留现有 `{ label, value }` 静态形状，并增加一个通用字段摘要形状：

```ts
type IntegrationSectionSummary =
  | { label: string; value: string }
  | {
      fields: Array<{
        key: string;
        emptyValue: string;
        valuePrefix?: string;
      }>;
      separator?: string;
    };
```

Sentry 过滤规则引用 `environment` 和 `query`，各自使用 `全部环境` 和 `未解决 Issue` 作为空值文本，使用 ` · ` 连接。字段摘要只能引用同一 Manifest 中已声明的非 Secret config field；引用不存在字段或 Secret key 时 Manifest 校验失败。该模型不执行任意表达式，也不增加 Sentry 专属 React 分支。

## 通用连接测试接口

### 插件契约

`IntegrationPlugin` 增加可选方法：

```ts
interface IntegrationConnectionTestDetail {
  label: string;
  value: string;
}

interface IntegrationConnectionTestResult {
  title: string;
  details: IntegrationConnectionTestDetail[];
  testedAt: string;
}

interface IntegrationPlugin {
  // 现有字段与方法保持不变
  testConnection?(
    context: IntegrationPluginConnectionTestContext,
  ): Promise<IntegrationConnectionTestResult>;
}

interface IntegrationPluginConnectionTestContext {
  projectId: string;
  configuration: ProjectIntegrationConfiguration;
  secrets: Readonly<Record<string, string>>;
  now(): Date;
}
```

结果只允许返回可公开展示的短文本。Runtime 通过严格 schema 验证结果；插件不得返回远程响应对象、请求头、Token、DSN 或 Issue 数据。未实现 `testConnection` 的插件不显示测试入口，也不能通过协议调用测试。

### Runtime operation

新增通用 operation，命名为 `testSavedIntegration`：

```ts
type TestSavedIntegrationInput = {
  projectId: string;
  integrationId: string;
};
```

这里的两个 ID 都属于 Oh My Bug ?!：

- `projectId` 定位本机已保存项目；
- `integrationId` 定位该项目中的 Integration 和已注册插件，例如 `sentry`。

Runtime 的处理顺序：

1. 查找本机项目，找不到时返回稳定的项目不存在错误。
2. 查找该项目保存的 Integration 配置，找不到时返回 Integration 未配置错误。
3. 查找注册插件并确认它实现 `testConnection`。
4. 按 Manifest 声明的 secret fields 从 Keychain 加载该项目的已保存密钥。
5. 调用插件 `testConnection`，不传入 Desktop 当前表单或密钥草稿。
6. 严格验证插件返回结果并交给 Desktop。
7. 失败时使用插件公开错误映射，只返回稳定错误码和本地化所需信息。

该 operation 是只读操作，不修改 Project revision、Integration health、checkpoint、密钥或脏状态。

### Desktop transport

Desktop transport 暴露与 Runtime 对应的通用方法。Project Form 只在以下条件同时成立时显示测试控件：

- Manifest 包含一个 `connectionTest: true` section；
- 当前 Integration 插件声明测试能力；
- 项目已经存在稳定的本机项目 ID。

`connectionTest: true` section 同时是测试入口的位置声明和序列化能力声明，是 Desktop 的单一信息来源。Integration registry 在注册插件时验证一致性：Manifest 含测试 section 时插件必须实现 `testConnection`；插件实现 `testConnection` 时 Manifest 必须恰好包含一个测试 section。Desktop 不猜测插件实现，Runtime operation 仍在调用前进行防御性检查。

## Sentry 测试实现

Sentry 插件使用已经保存的 Organization、Project、Environment、Query 和 Token。测试请求调用 Organization Issues API，并设置 `limit=1`，只验证目标项目的 Issue 读取权限和查询可用性。

测试必须：

- 使用 Bearer Auth token；
- 最多读取一条 Issue；
- 接受零条结果为连接成功；
- 不返回读取到的 Issue；
- 不创建、更新或删除任何 Sentry 数据；
- 不更新 Poller cursor 或 event watermark；
- 不启动或重启 Integration Poller；
- 不记录包含 Token 的 URL、Header 或错误对象。

成功结果：

```ts
{
  title: "连接成功",
  details: [
    { label: "Organization", value: config.organization },
    { label: "Project", value: config.project },
  ],
  testedAt: context.now().toISOString(),
}
```

Organization 与 Project 来自已经验证和 trim 的本地配置，不来自不可信远程响应。返回值不得包含 Token、Environment、Query、Issue 标题或 Issue ID。

## 页面状态与交互

### 初始状态

- 新项目：按钮禁用，显示“保存项目后可测试连接”。
- 已保存项目：按钮可用，显示“仅使用已保存的配置和凭证”。
- 已保存项目存在表单修改：按钮仍可用，并追加“当前修改不会用于本次测试”。
- 已保存 Token 继续显示“已配置”；进入替换状态不会改变测试数据来源。

### 测试中

- 按钮文案变为“测试中…”并仅禁用重复测试；
- 表单、启用开关、取消和保存仍可使用；
- 如果用户离开页面或项目，迟到的测试结果不得写入另一个项目的页面状态；
- 同一项目同一 Integration 只保留当前页面会话内最新一次请求的结果。

### 成功

成功区域使用 success 语义色、状态图形和文本共同表达，显示：

- “连接成功”；
- Organization；
- Project；
- 本次测试时间；
- “基于已保存配置”。

成功状态不写入数据库，刷新或离开页面后可以消失。

### 失败

失败区域位于“连接验证”分组，不复用页面底部的保存错误。错误码映射如下：

| 情况 | 页面文案 |
| --- | --- |
| Token 缺失或 `401` | “Auth token 无效或已失效。” |
| `403` | “Auth token 缺少读取事件的权限，请确认已授予 event:read。” |
| `404` | “Organization 或 Project 不存在，或当前 Token 无权访问。” |
| `400` | “已保存的过滤条件无法用于当前 Sentry 项目。” |
| 网络错误 | “无法连接 Sentry，请检查网络后重试。” |
| 必填配置缺失 | 指出 Organization、Project 或 Auth token 需要先保存。 |
| 插件不支持 | “该 Integration 不支持连接测试。” |
| 未知远程错误 | “Sentry 连接测试失败，请稍后重试。” |

公开错误不得包含远程响应正文、请求 URL query、Authorization Header、Token 或其他 secret bytes。

### 与保存和健康状态的关系

- 测试不触发保存，也不清除“有未保存的更改”。
- 保存成功不自动触发测试，避免一次保存产生额外远程请求。
- 测试成功不把 Integration health 改成 `connected`。
- 测试失败不把 Integration health 改成 `backoff`。
- 后台 Poller health 与手动测试结果同时存在时，分别使用“后台连接”和“手动验证”的明确语义。

## 数据安全

- Desktop 请求不携带 Token、Organization、Project、Environment 或 Query。
- Runtime 仅在执行测试期间从 Keychain 加载 Token，并沿用 secret redaction 约束。
- 测试结果 schema 只允许短文本详情，禁止未知字段。
- Sentry 公开错误映射必须把 HTTP 与网络错误转换为固定错误码。
- 测试日志不得输出远程请求 options、Authorization Header 或原始异常正文。
- Browser development transport 返回只读、确定性的模拟测试结果，不能引入真实网络访问。

## 可访问性与响应式

- 测试按钮拥有明确 accessible name，并在 disabled 状态旁显示可见原因。
- 测试进行状态通过按钮文本和 polite live region 宣告，不只使用 spinner。
- 失败结果使用 alert；成功结果使用 polite status。
- Organization、Project、测试时间以语义化定义列表或等价键值结构展示。
- 焦点顺序遵循页面视觉顺序：连接字段、测试按钮、过滤规则、底部操作。
- 折叠过滤规则使用原生或等价 disclosure 语义并支持键盘操作。
- 在窄窗口与 200% zoom 下，测试结果键值行改为单列，不产生横向滚动。
- 暗色和亮色主题都使用现有语义变量，组件不硬编码主题颜色。

## 测试策略

### Core 与 Manifest

- Manifest 支持可选连接测试 section 和序列化能力声明。
- 未声明连接测试的旧 Manifest 保持兼容。
- 一个 Manifest 中重复连接测试入口被拒绝。
- 插件能力与序列化 Manifest 的能力声明保持一致。
- 连接测试结果 schema 拒绝未知字段、空 label/value 和无效时间。

### Sentry 插件与客户端

- 测试使用已验证、trim 后的 Organization 和 Project。
- 请求使用 Organization Issues API、Bearer token 与 `limit=1`。
- 保存的 Environment 和 Query 被用于请求；未配置时不添加参数。
- 零条 Issue 返回连接成功。
- 成功结果只包含公开的 Organization、Project 和测试时间。
- `400`、`401`、`403`、`404`、网络错误和未知错误映射为稳定脱敏错误。
- 配置或密钥缺失时不发起网络请求。
- 测试不改变 checkpoint、Poller 或已接收 Issue。

### Runtime 与协议

- `testSavedIntegration` 输入与输出通过严格 schema。
- Runtime 只加载指定本机项目和 Integration 的已保存配置与密钥。
- 当前表单草稿无法通过此 operation 进入插件。
- 停用但配置完整的 Integration 允许测试。
- 项目不存在、Integration 未配置和插件不支持测试时返回稳定错误。
- 插件结果含 secret 或 schema 外字段时协议拒绝返回。
- operation 不改变 Project revision、Keychain、checkpoint 或 Integration health。

### Desktop

- Sentry 页面按“连接配置、连接验证、过滤规则”顺序渲染。
- 三项必填内容位于主要层级；过滤规则默认折叠。
- Query 留空时摘要说明默认接收未解决 Issue。
- 新项目测试按钮禁用并显示原因。
- 已保存项目测试时只提交本机项目 ID 和 Integration ID。
- 有未保存修改时测试仍可用并显示数据来源提示。
- loading、success、failure 和迟到响应状态正确。
- 测试不会触发保存、清除脏状态或覆盖后台 health。
- Token 未出现在 DOM、协议参数、测试结果或错误文案中。
- 暗色、亮色、窄窗口、200% zoom 和完整键盘操作通过检查。

### 端到端验收

- 创建项目并保存 Sentry 配置后可以触发测试。
- 新项目保存前无法测试。
- 修改未保存字段后测试仍使用旧配置，页面明确提示。
- 测试成功显示已保存 Organization / Project。
- 模拟权限错误时显示对应说明且不泄漏 Token。
- 保存错误、后台连接错误和手动测试错误保持三个独立反馈区域。

## 实施边界

预计涉及：

- `packages/core/src/integration/plugin.ts`
- `packages/integration-sentry/src/plugin.ts`
- `packages/integration-sentry/src/sentry-client.ts`
- `apps/runtime/src/protocol/*`
- `apps/runtime/src/service.ts`
- `apps/desktop/src/electron/desktop-api.ts`
- `apps/desktop/src/web/api/*`
- `apps/desktop/src/web/projects/integration-fields.tsx`
- `apps/desktop/src/web/projects/project-form.tsx`
- `apps/desktop/src/web/styles/global.css`
- 对应单元、组件、协议和端到端测试

不新增 Sentry 专属 Desktop 页面组件。允许新增通用 Integration connection test 组件和结果类型，使现有 Project Form 保持可理解的职责边界。
