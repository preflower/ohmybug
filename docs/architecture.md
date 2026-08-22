# 系统架构

当前设计由 Runtime 统一编排业务流程。Desktop Renderer 只是展示容器和人工触发点，因此不属于核心业务架构；它只通过 `@oh-my-bug/runtime/protocol` 与独立 Runtime 进程通信。

```mermaid
flowchart LR
  subgraph Plugins["Integration plugins"]
    Manual["Manual"]
    Sentry["Sentry"]
    DingTalk["DingTalk"]
  end

  Input["IntegrationInput\nrawData + data"]

  subgraph Runtime["Runtime"]
    Registry["Plugin registries"]
    Intake["Intake + deduplication"]
    Issue["Issue aggregate"]
    Worker["Assessment / Repair orchestration"]
    Session["Agent session lifecycle"]
  end

  subgraph Core["Core contracts"]
    AgentPort["AgentAdapter"]
    StorePort["RuntimeStore"]
    EvidencePort["EvidenceStore + EvidenceInspector"]
  end

  Codex["Codex Agent plugin"]
  Storage["Storage\nSQLite + Keychain + Evidence"]

  Plugins --> Input --> Intake --> Issue --> Worker
  Registry --> Plugins
  Worker --> Session --> AgentPort --> Codex
  Issue --> StorePort --> Storage
  Worker --> EvidencePort --> Storage
```

`@oh-my-bug/core` 只定义纯状态转换和跨包端口。具体 Agent、Integration 与 Storage 实现互不依赖，只有 `apps/runtime/src/composition.ts` 可以导入并组装它们。Integration 插件是内置包，但通过同一清单、校验和生命周期合同可插拔；Desktop 不包含任何渠道字段分支。

Runtime Worker 使用单进程有界调度器，同时推进最多 3 个不同 Issue。新进入队列的 Issue 会在存在空闲槽位时立即启动；同一 Issue 的 Workspace、Assessment、Repair、Evidence 与 Finalize 操作始终串行。每个 Issue 的独立 worktree 继续作为文件系统隔离边界，SQLite compare-and-swap 更新继续作为持久状态保护。

## Issue 主流程

```mermaid
stateDiagram-v2
  [*] --> RECEIVED: IntegrationInput accepted
  RECEIVED --> ASSESSING
  ASSESSING --> ASSESSMENT_REVIEW: Assessment ready
  ASSESSING --> ASSESSMENT_FAILED: Agent failure
  ASSESSMENT_FAILED --> ASSESSING: retry or confirmed session rebuild

  ASSESSMENT_REVIEW --> CLOSED: confirm NOT_A_BUG
  ASSESSMENT_REVIEW --> CLOSED: confirm DUPLICATE
  ASSESSMENT_REVIEW --> ASSESSING: request reassessment
  ASSESSMENT_REVIEW --> REPAIRING: approve BUG

  REPAIRING --> EVIDENCE_CHECK: Delivery ready
  EVIDENCE_CHECK --> REPAIRING: invalid visual evidence
  EVIDENCE_CHECK --> ACCEPTANCE_REVIEW: evidence accepted
  REPAIRING --> REPAIR_FAILED: Agent failure
  REPAIR_FAILED --> REPAIRING: retry or confirmed session rebuild

  ACCEPTANCE_REVIEW --> REPAIRING: reject Delivery
  ACCEPTANCE_REVIEW --> COMPLETED: approve Delivery / FIXED or IMPLEMENTED
```

Assessment 与全部 Repair iteration 使用同一个 provider-native 会话。会话缺失时 Runtime 以 `AGENT_SESSION_UNAVAILABLE` 明确失败，只有用户点击重建后才退休旧记录、创建新会话并恢复原阶段。Runtime 只接受截图或录屏证据；批准 Delivery 后 Issue 以 `COMPLETED / FIXED` 或 `COMPLETED / IMPLEMENTED` 结束。`CLOSED` 保留给 `NOT_A_BUG` 和 `DUPLICATE`。
