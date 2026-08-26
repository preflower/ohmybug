import { useEffect, useRef, useState } from "react";

import type { IntegrationConnectionTestResult } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";

interface IntegrationConnectionTestProps {
  projectId?: string;
  integrationId: string;
  dirty: boolean;
  onTest(
    projectId: string,
    integrationId: string,
  ): Promise<IntegrationConnectionTestResult>;
}

type ConnectionTestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: IntegrationConnectionTestResult }
  | { kind: "error"; message: string };

const messages: Record<string, string> = {
  SENTRY_CONNECTION_FILTER_INVALID: "已保存的过滤条件无法用于当前 Sentry 项目。",
  SENTRY_CONNECTION_TOKEN_INVALID: "Auth token 无效或已失效。",
  SENTRY_CONNECTION_PERMISSION_DENIED: "Auth token 缺少读取事件的权限，请确认已授予 event:read。",
  SENTRY_CONNECTION_RESOURCE_NOT_FOUND: "Organization 或 Project 不存在，或当前 Token 无权访问。",
  SENTRY_CONNECTION_NETWORK: "无法连接 Sentry，请检查网络后重试。",
  SENTRY_CONFIG_ORGANIZATION_REQUIRED: "请先保存 Organization。",
  SENTRY_CONFIG_PROJECT_REQUIRED: "请先保存 Project。",
  SENTRY_SECRET_TOKEN_REQUIRED: "请先保存 Auth token。",
  INTEGRATION_CONNECTION_TEST_UNSUPPORTED: "该 Integration 不支持连接测试。",
};

export function IntegrationConnectionTest({
  projectId,
  integrationId,
  dirty,
  onTest,
}: IntegrationConnectionTestProps) {
  const requestSequence = useRef(0);
  const [state, setState] = useState<ConnectionTestState>({ kind: "idle" });

  useEffect(() => {
    requestSequence.current += 1;
    setState({ kind: "idle" });
  }, [projectId, integrationId]);

  const run = async () => {
    if (!projectId) return;
    const request = ++requestSequence.current;
    setState({ kind: "loading" });
    try {
      const result = await onTest(projectId, integrationId);
      if (request === requestSequence.current) setState({ kind: "success", result });
    } catch (error) {
      if (request === requestSequence.current) {
        setState({ kind: "error", message: connectionErrorMessage(error, integrationId) });
      }
    }
  };

  return <section className="integration-connection-test">
    <div className="integration-connection-test-action">
      <Button
        disabled={!projectId || state.kind === "loading"}
        type="button"
        onClick={() => { void run(); }}
      >
        {state.kind === "loading" ? "测试中…" : "测试已保存配置"}
      </Button>
      <small>{projectId ? "仅使用已保存的配置和凭证。" : "保存项目后可测试连接"}</small>
      {projectId && dirty ? <small>当前修改不会用于本次测试</small> : null}
    </div>
    {state.kind === "success" ? <div
      aria-live="polite"
      className="integration-connection-test-result"
      role="status"
    >
      <strong>{state.result.title}</strong>
      <dl>
        {state.result.details.map((detail) => <div key={detail.label}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>)}
      </dl>
      <footer>
        <span>基于已保存配置</span>
        <time dateTime={state.result.testedAt}>
          {new Date(state.result.testedAt).toLocaleString("zh-CN")}
        </time>
      </footer>
    </div> : null}
    {state.kind === "error" ? <Alert variant="destructive">
      <AlertDescription>{state.message}</AlertDescription>
    </Alert> : null}
  </section>;
}

function connectionErrorMessage(error: unknown, integrationId: string): string {
  const candidateCode = error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
  return messages[candidateCode]
    ?? (integrationId.toLocaleLowerCase() === "sentry"
      ? "Sentry 连接测试失败，请稍后重试。"
      : "连接测试失败，请稍后重试。");
}
