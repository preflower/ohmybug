import { Globe2, ShieldAlert, TerminalSquare } from "lucide-react";
import { useState } from "react";

import type { IssueDto } from "../api/types.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";

interface CapabilityRequestPanelProps {
  request: NonNullable<IssueDto["pendingCapabilityRequest"]>;
  onGrant(): Promise<void>;
  onCancel(): Promise<void>;
}

type Capability = NonNullable<IssueDto["pendingCapabilityRequest"]>["capabilities"][number];

const capabilityLabels = {
  HOST_EXECUTION: {
    title: "宿主执行权限",
    description: "不受工作区沙箱限制的宿主命令执行权限，可启动 GUI、Electron 和其他进程，并访问工作区外文件。",
    icon: TerminalSquare,
  },
  NETWORK_ACCESS: {
    title: "网络访问",
    description: "允许当前 Issue 的 Agent 回合访问网络。",
    icon: Globe2,
  },
} satisfies Record<Capability, {
  title: string;
  description: string;
  icon: typeof Globe2;
}>;

const stageLabels = {
  ASSESSMENT: "分析",
  REPAIR: "实现",
  EVIDENCE: "证据采集",
} as const;

export function CapabilityRequestPanel({
  request,
  onGrant,
  onCancel,
}: CapabilityRequestPanelProps) {
  const [busy, setBusy] = useState<"grant" | "cancel">();
  const [error, setError] = useState("");
  const [hostConfirmationOpen, setHostConfirmationOpen] = useState(false);
  const requiresHostConfirmation = request.capabilities.includes("HOST_EXECUTION");

  const run = async (kind: "grant" | "cancel", action: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : kind === "grant" ? "授权失败" : "取消失败");
    } finally {
      setBusy(undefined);
    }
  };

  const grant = () => {
    setHostConfirmationOpen(false);
    void run("grant", onGrant);
  };

  return (
    <section aria-label="权限申请" className="capability-request-panel">
      <header>
        <ShieldAlert aria-hidden="true" size={18} />
        <div>
          <span>权限不足</span>
          <h3>Agent 需要额外能力才能继续{stageLabels[request.stage]}</h3>
        </div>
      </header>

      <p>{request.reason}</p>
      <ul className="capability-request-list">
        {request.capabilities.map((capability) => {
          const item = capabilityLabels[capability];
          const Icon = item.icon;
          return <li key={capability}>
            <Icon aria-hidden="true" size={15} />
            <div><strong>{item.title}</strong><span>{item.description}</span></div>
          </li>;
        })}
      </ul>

      {request.blockedCommand || request.requestedBy ? <dl className="capability-request-meta">
        {request.blockedCommand ? <div><dt>受阻命令</dt><dd><code>{request.blockedCommand}</code></dd></div> : null}
        {request.requestedBy ? <div><dt>申请方</dt><dd>{request.requestedBy.type === "SKILL" ? `Skill${request.requestedBy.id ? ` · ${request.requestedBy.id}` : ""}` : "Agent"}</dd></div> : null}
      </dl> : null}

      {error ? <Alert className="form-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="capability-request-actions">
        <Button disabled={Boolean(busy)} type="button" variant="secondary" onClick={() => void run("cancel", onCancel)}>
          {busy === "cancel" ? "取消中…" : "取消 Issue"}
        </Button>
        <Button disabled={Boolean(busy)} type="button" onClick={() => {
          setError("");
          if (requiresHostConfirmation) setHostConfirmationOpen(true);
          else grant();
        }}>
          {busy === "grant" ? "授权中…" : "授权并继续"}
        </Button>
      </div>

      {requiresHostConfirmation ? <Dialog open={hostConfirmationOpen} onOpenChange={setHostConfirmationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>授权宿主执行权限？</DialogTitle>
            <DialogDescription>
              授权后，当前 Issue 在完成或取消前可执行不受工作区沙箱限制的宿主命令，包括启动 GUI、Electron 和其他进程，以及访问工作区外文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button disabled={Boolean(busy)} type="button" variant="secondary" />}>返回</DialogClose>
            <Button disabled={Boolean(busy)} type="button" onClick={grant}>确认授权并继续</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog> : null}
    </section>
  );
}
