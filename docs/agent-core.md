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

pause / resume / cancel
```

## Assessment

Assessment 包含 revision、规范化 content hash、`BUG | FEATURE | NOT_A_BUG | UNCERTAIN`、reasoning，以及可选 root cause、solution 和疑似重复 Issue。所有 verdict 都生成 `REVIEW_REQUIRED` 下的 `assessment` 请求，只有人工选择有限选项后才能实现、重分析或关闭。“确认为重复 Issue”仅在 Agent 给出 `suspectedDuplicateOf` 候选时出现并预填，最终仍由人工确认。

## Repair 与证据

批准 Bug 或 Feature Assessment 后，Runtime 将 Issue、Project 上下文、Assessment、反馈、前次 Delivery 和一个受控证据目录交给 Agent。Git 项目配置为合入基线时，输入还包含当前不可变的基线 commit 和 Issue 分支；Agent 必须在隔离 worktree 中完成实现、合入基线、处理可兼容冲突、提交并运行验证。若两边要求的可观察业务行为不能同时成立，Agent 返回有限业务选项，Runtime 以 `business-merge-conflict` 审核暂停并在用户选择后沿用同一会话、同一 Repair iteration 继续。

Agent 返回 summary、集成快照、验证结果与截图/录屏的相对路径；Storage 负责路径约束、内容寻址、媒体解码和 `evidenceId`。失败证据会回到同一会话的下一次 Repair。Git Provider 只发布已验证且包含所观察基线的 commit，并只允许受保护的 fast-forward；发布前基线漂移会重新进入 Repair，而不是在主工作目录内临时解冲突。

人工拒绝 Delivery 会带反馈继续 Repair；批准后先执行受保护发布，成功才完成为 `FIXED` 或 `IMPLEMENTED`。Agent 的交付边界是包含截图或录屏的 Delivery。

## 会话

同一 Issue 的 Assessment、重分析和所有 Repair iteration 必须复用同一个逻辑会话及 provider-native 会话。Codex provider 会话不存在时，插件抛出精确的 `AGENT_SESSION_UNAVAILABLE`，不会自动创建替代上下文。

Issue 详情只对该错误显示“重建 Agent 会话”。用户确认后，Runtime 在同一个事务中退休旧会话、绑定新的逻辑会话、记录重建事件并恢复失败阶段；Issue、Assessment、Delivery 与反馈历史保持不变。

## 暂停、继续与取消

`pauseIssue` 先持久化 `PAUSED + pauseContext`，再以 `USER_PAUSED` 中断当前 Agent 回合。`pauseContext` 记录原操作和恢复状态，因此 Runtime 重启不会自动运行已暂停 Issue，也不需要猜测暂停前的阶段。

`resumeIssue` 消费 `pauseContext`，重新排队原操作，并把 `USER_RESUMED` continuation 交给同一个逻辑会话。工作目录、Assessment、Repair iteration、Delivery draft 和恢复诊断保持不变；暂停前回合的迟到结果因 revision 与状态校验不能覆盖暂停快照。

`cancelIssue` 是终态操作，只用于用户明确取消整个 Issue，不用于暂停 Agent。Agent 活跃阶段提供暂停；已暂停和其他可中断的被动阶段提供终态取消；`FINALIZING` 及终态不再提供生命周期操作。

确定性 Demo Agent 只存在于 Electron E2E 的一次性 token 握手路径，生产 Runtime 没有用户可配置的 Demo 开关。
