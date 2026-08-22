import type {
  ConfigValue,
  WorkspaceBranchDiscoveryDto,
  WorkspaceProviderInspection,
} from "../api/types.js";
import { Switch } from "../components/ui/switch.js";
import { GitBranchCombobox } from "./git-branch-combobox.js";

interface GitWorkspaceFieldsProps {
  config: Record<string, ConfigValue>;
  discovery: WorkspaceBranchDiscoveryDto;
  pushState?: NonNullable<WorkspaceProviderInspection["fields"]>[string];
  onChange(key: string, value: ConfigValue): void;
  onRefreshBranches(): Promise<WorkspaceBranchDiscoveryDto>;
}

export function GitWorkspaceFields({
  config,
  discovery,
  pushState,
  onChange,
  onRefreshBranches,
}: GitWorkspaceFieldsProps) {
  const baseBranch = String(config.baseBranch ?? "main");
  const pushEnabled = pushState?.enabled ?? Boolean(discovery.remote);
  const remote = discovery.remote;
  const reasonId = pushState?.reason ? "git-push-availability" : undefined;

  return <>
    <label>基线分支
      <GitBranchCombobox
        discovery={discovery}
        onChange={(value) => onChange("baseBranch", value)}
        onRefresh={onRefreshBranches}
        value={baseBranch}
      />
    </label>
    <div className="git-publication-field">
      <div className="git-publication-copy">
        <strong id="git-push-label">完成后推送到远程</strong>
        <small>Issue 完成后，将本地 Issue 分支发布到当前远程仓库。</small>
        {remote ? <>
          <code title={remote.url}>{remote.url}</code>
          <small>Git remote: {remote.name}</small>
        </> : null}
        {pushState?.reason ? <small id={reasonId}>{pushState.reason}</small> : null}
      </div>
      <Switch
        aria-describedby={reasonId}
        aria-labelledby="git-push-label"
        checked={pushEnabled && Boolean(config.pushToRemote)}
        disabled={!pushEnabled}
        onCheckedChange={(checked) => onChange("pushToRemote", checked)}
      />
    </div>
  </>;
}
