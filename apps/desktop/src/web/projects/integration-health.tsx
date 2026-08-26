import type { IntegrationHealth } from "../api/types.js";

export function IntegrationHealthStatus({
  enabled,
  health,
}: {
  enabled: boolean;
  health?: IntegrationHealth;
}) {
  if (!enabled) return null;
  const state = health?.state ?? "stopped";
  const label = state === "connected"
    ? "已连接"
    : state === "connecting"
      ? "正在连接"
      : state === "backoff"
        ? `连接失败，正在重试${health?.lastError ? `：${health.lastError}` : ""}`
        : "已停用";

  return <div className={`integration-health integration-health-${state}`} role="status">
    <i aria-hidden="true" className="integration-health-dot" />
    <span>{label}</span>
    {state === "backoff" && health?.nextRetryAt
      ? <small>将在 {new Date(health.nextRetryAt).toLocaleTimeString()} 重试</small>
      : null}
  </div>;
}
