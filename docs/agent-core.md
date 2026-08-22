# Agent Adapter 边界

Runtime 拥有 Issue 状态机、会话生命周期、持久化、人工门禁、Repair loop 和证据验收。Agent 插件只提供四个能力：

```text
createSession
  → assess
  → 人工确认 Assessment
  → repair
  → Runtime 导入并检查截图/录屏
  → 人工确认 Delivery
  → COMPLETED / FIXED or IMPLEMENTED

cancel
```

## Assessment

Assessment 包含 revision、规范化 content hash、`BUG | NOT_A_BUG | UNCERTAIN`、reasoning，以及可选 root cause、solution 和疑似重复 Issue。三种 verdict 都先进入 `ASSESSMENT_REVIEW`，只有人工确认后才能修复或关闭。

## Repair 与证据

批准 Bug Assessment 后，Runtime 将 Issue、Project 上下文、Assessment、反馈、前次 Delivery 和一个受控证据目录交给 Agent。Agent 返回 summary 与截图/录屏的相对路径；Storage 负责路径约束、内容寻址、媒体解码和 `evidenceId`。失败证据会回到同一会话的下一次 Repair。

人工拒绝 Delivery 会带反馈继续 Repair；批准则立即完成为 `FIXED` 或 `IMPLEMENTED`。Agent 的交付边界是包含截图或录屏的 Delivery。

## 会话

同一 Issue 的 Assessment、重分析和所有 Repair iteration 必须复用同一个逻辑会话及 provider-native 会话。Codex provider 会话不存在时，插件抛出精确的 `AGENT_SESSION_UNAVAILABLE`，不会自动创建替代上下文。

Issue 详情只对该错误显示“重建 Agent 会话”。用户确认后，Runtime 在同一个事务中退休旧会话、绑定新的逻辑会话、记录重建事件并恢复失败阶段；Issue、Assessment、Delivery 与反馈历史保持不变。

确定性 Demo Agent 只存在于 Electron E2E 的一次性 token 握手路径，生产 Runtime 没有用户可配置的 Demo 开关。
