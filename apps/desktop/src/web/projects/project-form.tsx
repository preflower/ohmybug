import { useMemo, useRef, useState, type FormEvent } from "react";
import { Bot, ClipboardCheck, Folder, MessageCircle, Plug, Webhook } from "lucide-react";
import { toast } from "sonner";

import { DingTalkIcon, SentryIcon } from "../components/brand-icons.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Textarea } from "../components/ui/textarea.js";
import { Switch } from "../components/ui/switch.js";
import type { ConfigValue, IntegrationConnectionTestResult, IntegrationHealth, IntegrationPluginManifest, ProjectDto, ProjectInspection, WorkspaceBranchDiscoveryDto, WorkspaceProviderManifest } from "../api/types.js";
import { ConfigFields } from "./config-fields.js";
import { isConfigFieldVisible, withConditionalConfigDefaults } from "./config-field-visibility.js";
import { GitWorkspaceFields } from "./git-workspace-fields.js";
import { IntegrationFields } from "./integration-fields.js";
import { IntegrationHealthStatus } from "./integration-health.js";

export interface ProjectIntegrationFormValue {
  enabled: boolean;
  config: Record<string, ConfigValue>;
  secretConfigured: Record<string, boolean>;
}

export interface ProjectFormValue {
  id?: string;
  revision?: number;
  name: string;
  key: string;
  path: string;
  instructions: string;
  agentPlugin: string;
  commands: NonNullable<ProjectDto["commands"]>;
  integrations: Record<string, ProjectIntegrationFormValue>;
  workspace: { provider: string; config: Record<string, ConfigValue> };
}

interface ProjectFormProps {
  manifests: IntegrationPluginManifest[];
  workspaceProviders?: WorkspaceProviderManifest[];
  initial?: ProjectDto;
  inspection?: ProjectInspection;
  onCancel?(): void;
  onSelectDirectory?(): Promise<
    { canceled: true } | { canceled: false; inspection: ProjectInspection }
  >;
  onRefreshWorkspaceBranches?(
    path: string,
    providerId: string,
  ): Promise<WorkspaceBranchDiscoveryDto>;
  health?: Record<string, IntegrationHealth>;
  onTestSavedIntegration?(
    projectId: string,
    integrationId: string,
  ): Promise<IntegrationConnectionTestResult>;
  onSave(
    project: ProjectFormValue,
    secretPatches: Record<string, Record<string, string | null>>,
  ): Promise<ProjectDto | void>;
}

type ProjectField = "name" | "key" | "path";
type EvidenceCaptureMode = "agent" | "browser" | "electron" | "command";

const localWorkspaceProvider: WorkspaceProviderManifest = {
  id: "local",
  name: "本机目录",
  configFields: [],
};

export function ProjectForm({ manifests, workspaceProviders = [localWorkspaceProvider], initial, inspection, onCancel, onSelectDirectory, onRefreshWorkspaceBranches, health = {}, onTestSavedIntegration = unsupportedConnectionTest, onSave }: ProjectFormProps) {
  const allManifests = useMemo(() => withUnavailableManifests(manifests, initial), [manifests, initial]);
  const allWorkspaceProviders = useMemo(
    () => withUnavailableWorkspaceProviders(workspaceProviders, initial),
    [workspaceProviders, initial],
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [project, setProject] = useState<ProjectFormValue>(() => initialValue(allManifests, allWorkspaceProviders, initial, inspection));
  const [projectInspection, setProjectInspection] = useState(inspection);
  const [activeTab, setActiveTab] = useState("project");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProjectField, string>>>({});
  const [secretValues, setSecretValues] = useState<Record<string, Record<string, string>>>({});
  const [editingSecrets, setEditingSecrets] = useState<Record<string, Record<string, boolean>>>({});
  const [integrationErrors, setIntegrationErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial));
  const [saveConfirmed, setSaveConfirmed] = useState(false);

  const updateProject = (update: (current: ProjectFormValue) => ProjectFormValue) => {
    setSaved(false);
    setSaveConfirmed(false);
    setProject(update);
  };

  const setField = (key: ProjectField, value: string) => {
    setSaved(false);
    setSaveConfirmed(false);
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setProject((current) => ({ ...current, [key]: value }));
  };

  const selectDirectory = async () => {
    if (!onSelectDirectory) return;
    const selection = await onSelectDirectory();
    if (selection.canceled) return;
    const nextInspection = selection.inspection;
    setProjectInspection(nextInspection);
    setFieldErrors((current) => ({ ...current, path: undefined }));
    updateProject((current) => {
      const provider = allWorkspaceProviders.find((candidate) => candidate.id === current.workspace.provider)
        ?? localWorkspaceProvider;
      return {
        ...current,
        path: nextInspection.path,
        workspace: mergeWorkspaceInspection({
          provider: current.workspace.provider,
          config: defaults(provider),
        }, nextInspection),
      };
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: Partial<Record<ProjectField, string>> = {};
    if (!project.name.trim()) errors.name = "请输入项目名称";
    if (!project.key.trim()) errors.key = "请输入项目标识";
    if (!project.path.trim()) errors.path = "请输入本机项目路径";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setActiveTab("project");
      return;
    }
    const integrationValidation = validateIntegrations(project, manifests, secretValues);
    if (integrationValidation) {
      setIntegrationErrors({ [integrationValidation.pluginId]: integrationValidation.message });
      setActiveTab(integrationValidation.pluginId);
      setTimeout(() => focusIntegrationField(formRef.current, integrationValidation.fieldKey), 0);
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const normalized = {
        ...project,
        key: project.key.trim().toUpperCase(),
        commands: normalizeCommands(project.commands),
        integrations: normalizeIntegrations(project.integrations, manifests),
      };
      const next = await onSave(normalized, collectSecretPatches(secretValues));
      setProject(next
        ? initialValue(allManifests, allWorkspaceProviders, next, projectInspection)
        : normalized);
      setSecretValues({});
      setEditingSecrets({});
      setIntegrationErrors({});
      setSaved(true);
      setSaveConfirmed(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存更改失败");
    } finally {
      setSaving(false);
    }
  };

  return <form className="project-form" data-testid="project-settings-form" id="project-settings-form" noValidate onSubmit={submit} ref={formRef}>
    <Tabs className="project-settings-tabs" orientation="vertical" value={activeTab} onValueChange={setActiveTab}>
      <TabsList aria-label="项目配置" className="project-settings-nav" variant="line">
        <span className="project-settings-nav-label" role="presentation">项目设置</span>
        <TabsTrigger value="project"><Folder aria-hidden="true" />项目</TabsTrigger>
        <TabsTrigger value="agent"><Bot aria-hidden="true" />Agent</TabsTrigger>
        <TabsTrigger value="commands"><ClipboardCheck aria-hidden="true" />命令与验收</TabsTrigger>
        <span className="project-settings-nav-label project-settings-nav-label-integrations" role="presentation">集成</span>
        {allManifests.map((manifest) => <TabsTrigger key={manifest.id} value={manifest.id}><IntegrationNavIcon icon={manifest.icon} />{manifest.name}</TabsTrigger>)}
      </TabsList>
      <div className="project-settings-main"><div className="project-settings-content">
        {activeTab === "project" ? <div className="flex-1 text-sm outline-none" role="tabpanel"><section className="project-settings-panel project-overview-panel"><div className="section-heading"><div><h2>项目</h2><p>Agent 在这个本机项目目录中工作。</p></div></div><div className="form-grid">
          <label>项目名称<Input aria-label="项目名称" invalid={Boolean(fieldErrors.name)} name="name" value={project.name} onChange={(event) => setField("name", event.target.value)} />{fieldErrors.name ? <small className="field-error">{fieldErrors.name}</small> : null}</label>
          <label>项目标识<Input aria-label="项目标识" invalid={Boolean(fieldErrors.key)} name="key" value={project.key} onChange={(event) => setField("key", event.target.value)} />{fieldErrors.key ? <small className="field-error">{fieldErrors.key}</small> : null}</label>
          <label className="field-wide project-path-field">本机项目路径<div className="project-path-control"><Input aria-label="本机项目路径" invalid={Boolean(fieldErrors.path)} name="path" readOnly={Boolean(initial || projectInspection)} value={project.path} onChange={(event) => setField("path", event.target.value)} />{onSelectDirectory ? <Button type="button" variant="outline" onClick={() => { void selectDirectory(); }}>重新选择目录</Button> : null}</div>{fieldErrors.path ? <small className="field-error">{fieldErrors.path}</small> : null}<small className="project-local-note">项目路径和配置仅保存在这台电脑上。</small></label>
        </div><dl className="project-configuration-summary" aria-label="项目配置摘要"><div><dt>Agent</dt><dd>{project.agentPlugin === "codex" ? "Codex" : project.agentPlugin}</dd></div><div><dt>已启用集成</dt><dd>{Object.values(project.integrations).filter((integration) => integration.enabled).length}</dd></div></dl><section className="project-workspace-section"><div className="section-heading"><div><h3>工作目录</h3><p>选择直接使用项目目录，或为每个 Issue 创建隔离的 Git Worktree。</p></div></div><div className="form-grid">
          <label>工作目录方式<Select items={Object.fromEntries(allWorkspaceProviders.map((provider) => [provider.id, provider.name]))} value={project.workspace.provider} onValueChange={(providerId) => {
            if (providerId === null) return;
            const provider = allWorkspaceProviders.find((candidate) => candidate.id === providerId);
            if (!provider) return;
            const providerInspection = projectInspection?.workspaces[providerId];
            updateProject((current) => ({
              ...current,
              workspace: {
                provider: providerId,
                config: {
                  ...defaults(provider),
                  ...(providerInspection?.configPatch ?? {}),
                },
              },
            }));
          }}><SelectTrigger aria-label="工作目录方式"><SelectValue /></SelectTrigger><SelectContent>{allWorkspaceProviders.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></label>
          {project.workspace.provider === "git" ? <GitWorkspaceFields
            config={project.workspace.config}
            discovery={projectInspection?.workspaces.git?.branches ?? {
              localBranches: [String(project.workspace.config.baseBranch ?? "main")],
              remoteBranches: [],
              publicationRemotes: [],
            }}
            pushState={projectInspection?.workspaces.git?.fields?.pushToRemote}
            onChange={(key, value) => updateProject((current) => ({ ...current, workspace: { ...current.workspace, config: { ...current.workspace.config, [key]: value } } }))}
            onRefreshBranches={() => onRefreshWorkspaceBranches
              ? onRefreshWorkspaceBranches(project.path, project.workspace.provider)
                : Promise.resolve(projectInspection?.workspaces.git?.branches ?? {
                  localBranches: [String(project.workspace.config.baseBranch ?? "main")],
                  remoteBranches: [],
                  publicationRemotes: [],
                })}
          /> : <ConfigFields fields={allWorkspaceProviders.find((provider) => provider.id === project.workspace.provider)?.configFields ?? []} config={project.workspace.config} idPrefix={`workspace-${project.workspace.provider}`} inspection={projectInspection?.workspaces[project.workspace.provider]} onChange={(key, value) => updateProject((current) => ({ ...current, workspace: { ...current.workspace, config: { ...current.workspace.config, [key]: value } } }))} />}
          {initial?.workspace?.unavailable ? <p className="field-wide">{initial.workspace.unavailable}</p> : null}
          {projectInspection?.workspaces[project.workspace.provider]?.available === false ? <p className="field-wide field-error">{projectInspection.workspaces[project.workspace.provider]?.reason}</p> : null}
        </div></section><section className="workspace-permission"><h3>工作目录权限</h3><p>Agent 对文件的所有读写操作都将被限制在此项目目录中。</p></section></section></div> : null}
        {activeTab === "agent" ? <div className="flex-1 text-sm outline-none" role="tabpanel"><section className="project-settings-panel"><div className="section-heading"><div><h2>Agent</h2><p>选择能力实现，并提供项目指令。</p></div></div><div className="form-grid">
          <label>Agent 插件<Select items={{ codex: "Codex", ...(project.agentPlugin === "codex" ? {} : { [project.agentPlugin]: project.agentPlugin }) }} value={project.agentPlugin} onValueChange={(agentPlugin) => {
            if (agentPlugin !== null) updateProject((current) => ({ ...current, agentPlugin }));
          }}><SelectTrigger aria-label="Agent 插件"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="codex">Codex</SelectItem>{project.agentPlugin !== "codex" ? <SelectItem value={project.agentPlugin}>{project.agentPlugin}</SelectItem> : null}</SelectContent></Select></label>
          <label className="field-wide">项目指令<Textarea aria-label="项目指令" rows={4} value={project.instructions} onChange={(event) => updateProject((current) => ({ ...current, instructions: event.target.value }))} /></label>
        </div></section></div> : null}
        {activeTab === "commands" ? <div className="flex-1 text-sm outline-none" role="tabpanel"><section className="project-settings-panel"><div className="section-heading"><div><h2>命令与验收</h2><p>这些命令会作为项目上下文提供给 Agent。</p></div></div><div className="form-grid">
          {(["install", "test", "start", "acceptanceUrl"] as const).map((key) => <label key={key}>{commandLabel(key)}<Input value={project.commands[key] ?? ""} onChange={(event) => updateProject((current) => ({ ...current, commands: { ...current.commands, [key]: event.target.value || undefined } }))} /></label>)}
          <label>证据采集方式<Select items={{ agent: "Agent", browser: "浏览器", electron: "Electron", command: "命令" }} value={project.commands.evidenceCapture?.mode ?? "agent"} onValueChange={(mode) => {
            if (mode !== null) updateProject((current) => ({
              ...current,
              commands: setEvidenceCaptureMode(current.commands, mode as EvidenceCaptureMode),
            }));
          }}><SelectTrigger aria-label="证据采集方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="agent">Agent</SelectItem><SelectItem value="browser">浏览器</SelectItem><SelectItem value="electron">Electron</SelectItem><SelectItem value="command">命令</SelectItem></SelectContent></Select></label>
          {project.commands.evidenceCapture ? <>
            <label>证据标签<Input aria-label="证据标签" value={project.commands.evidenceCapture.label} onChange={(event) => updateProject((current) => ({ ...current, commands: updateEvidenceCapture(current.commands, { label: event.target.value }) }))} /></label>
            <label>超时（毫秒）<Input aria-label="超时（毫秒）" min={1000} max={120000} type="number" value={project.commands.evidenceCapture.timeoutMs ?? 15000} onChange={(event) => updateProject((current) => ({ ...current, commands: updateEvidenceCapture(current.commands, { timeoutMs: Number(event.target.value) || 15000 }) }))} /></label>
            {project.commands.evidenceCapture.mode === "electron" ? <label>Electron 入口<Input aria-label="Electron 入口" value={project.commands.evidenceCapture.electronEntry} onChange={(event) => updateProject((current) => {
              const capture = current.commands.evidenceCapture;
              return capture?.mode === "electron" ? { ...current, commands: { ...current.commands, evidenceCapture: { ...capture, electronEntry: event.target.value } } } : current;
            })} /></label> : null}
            {project.commands.evidenceCapture.mode === "command" ? <label>证据命令<Input aria-label="证据命令" value={project.commands.evidenceCapture.command} onChange={(event) => updateProject((current) => {
              const capture = current.commands.evidenceCapture;
              return capture?.mode === "command" ? { ...current, commands: { ...current.commands, evidenceCapture: { ...capture, command: event.target.value } } } : current;
            })} /></label> : null}
            {project.commands.evidenceCapture.mode === "browser" ? <p className="field-wide project-local-note">浏览器采集需要启动命令和 localhost 验收 URL。</p> : null}
          </> : null}
        </div></section></div> : null}
        {allManifests.map((manifest) => {
          const value = project.integrations[manifest.id] ?? { enabled: false, config: {}, secretConfigured: {} };
          const unavailable = initial?.integrations?.[manifest.id]?.unavailable;
          return activeTab === manifest.id ? <div className="flex-1 text-sm outline-none" key={manifest.id} role="tabpanel"><section className="project-settings-panel">
            <div className="section-heading integration-heading"><div><h2>{manifest.name}</h2>{manifest.description ? <p>{manifest.description}</p> : null}{unavailable ? <p>{unavailable}</p> : null}<IntegrationHealthStatus enabled={value.enabled} health={project.id ? health[`${project.id}:${manifest.id}`] : undefined} /></div><div className="switch-row"><span>{value.enabled ? "已启用" : "已停用"}</span><Switch aria-label="启用" checked={value.enabled} disabled={Boolean(unavailable)} onCheckedChange={(checked) => updateProject((current) => ({
              ...current,
              integrations: {
                ...current.integrations,
                [manifest.id]: { ...value, enabled: Boolean(checked) },
              },
            }))} /></div></div>
            {integrationErrors[manifest.id] ? <Alert className="integration-validation-alert" variant="destructive"><AlertDescription>{integrationErrors[manifest.id]}</AlertDescription></Alert> : null}
            <IntegrationFields
              manifest={manifest}
              config={value.config}
              dirty={!saved}
              projectId={project.id}
              secretConfigured={value.secretConfigured}
              secretValues={secretValues[manifest.id] ?? {}}
              editingSecrets={editingSecrets[manifest.id] ?? {}}
              onTestSavedIntegration={onTestSavedIntegration}
              onConfigChange={(key, configValue) => updateProject((current) => ({
                ...current,
                integrations: {
                  ...current.integrations,
                  [manifest.id]: {
                    ...value,
                    config: { ...value.config, [key]: configValue },
                  },
                },
              }))}
              onSecretChange={(key, secretValue) => {
                setSaved(false);
                setSaveConfirmed(false);
                setIntegrationErrors((current) => ({ ...current, [manifest.id]: "" }));
                setSecretValues((current) => ({
                  ...current,
                  [manifest.id]: { ...current[manifest.id], [key]: secretValue },
                }));
              }}
              onEditSecret={(key, editing) => setEditingSecrets((current) => ({
                ...current,
                [manifest.id]: { ...current[manifest.id], [key]: editing },
              }))}
            />
          </section></div> : null;
        })}
      </div><footer className="project-settings-actions"><div className="project-settings-status">{saved ? <span aria-live="polite" role={saveConfirmed ? "status" : undefined}><i className="state-dot" />所有更改已保存</span> : <span>有未保存的更改</span>}</div><div className="project-settings-action-buttons">{onCancel ? <Button type="button" variant="secondary" onClick={onCancel}>取消</Button> : null}<Button disabled={saving} type="submit">{saving ? "保存中…" : "保存更改"}</Button></div></footer></div>
    </Tabs>
  </form>;
}

function unsupportedConnectionTest(): Promise<never> {
  return Promise.reject(new Error("INTEGRATION_CONNECTION_TEST_UNSUPPORTED"));
}

function initialValue(manifests: IntegrationPluginManifest[], workspaceProviders: WorkspaceProviderManifest[], initial?: ProjectDto, inspection?: ProjectInspection): ProjectFormValue {
  const integrations = Object.fromEntries(manifests.map((manifest) => {
    const stored = initial?.integrations?.[manifest.id];
    return [manifest.id, {
      enabled: stored?.enabled ?? false,
      config: withConditionalConfigDefaults(manifest.configFields, stored?.config ?? {}),
      secretConfigured: stored?.secretConfigured ?? {},
    }];
  }));
  const workspace = initial?.workspace
    ? {
        provider: initial.workspace.provider,
        config: normalizeWorkspaceConfig(initial.workspace.provider, initial.workspace.config),
      }
    : {
        provider: workspaceProviders.find((provider) => provider.id === "local")?.id
          ?? workspaceProviders[0]?.id
          ?? "local",
        config: defaults(
          workspaceProviders.find((provider) => provider.id === "local")
            ?? workspaceProviders[0]
            ?? localWorkspaceProvider,
        ),
      };
  return {
    ...(initial ? { id: initial.id, revision: initial.revision } : {}),
    name: initial?.name ?? inspection?.name ?? "",
    key: initial?.key ?? inspection?.key ?? "",
    path: initial?.path ?? inspection?.path ?? "",
    instructions: initial?.instructions ?? "",
    agentPlugin: initial?.agent?.plugin ?? "codex",
    commands: { ...initial?.commands },
    integrations,
    workspace: inspection ? mergeWorkspaceInspection(workspace, inspection) : workspace,
  };
}

function IntegrationNavIcon({ icon }: { icon?: IntegrationPluginManifest["icon"] }) {
  if (icon === "sentry") return <SentryIcon aria-hidden="true" />;
  if (icon === "dingtalk") return <DingTalkIcon aria-hidden="true" />;
  const Icon = icon === "messageCircle" ? MessageCircle : icon === "webhook" ? Webhook : Plug;
  return <Icon aria-hidden="true" />;
}

function mergeWorkspaceInspection(
  workspace: ProjectFormValue["workspace"],
  inspection: ProjectInspection,
): ProjectFormValue["workspace"] {
  const providerInspection = inspection.workspaces[workspace.provider];
  const normalized = normalizeWorkspaceConfig(workspace.provider, workspace.config);
  const config = {
    ...(providerInspection?.configPatch ?? {}),
    ...normalized,
  };
  const configuredRemoteAvailable = workspace.provider === "git"
    && typeof config.remote === "string"
    && providerInspection?.branches?.publicationRemotes.some(
      (remote) => remote.name === config.remote,
    );
  if (
    workspace.provider === "git"
    && providerInspection?.fields?.pushToRemote?.enabled === false
    && !configuredRemoteAvailable
  ) {
    config.pushToRemote = false;
  }
  return {
    ...workspace,
    config,
  };
}

function normalizeWorkspaceConfig(
  providerId: string,
  config: Record<string, ConfigValue>,
): Record<string, ConfigValue> {
  if (providerId !== "git" || !("delivery" in config)) return { ...config };
  const { delivery, ...rest } = config;
  return { ...rest, pushToRemote: delivery === "remote" };
}

function defaults(manifest: Pick<IntegrationPluginManifest, "configFields">): Record<string, ConfigValue> {
  return Object.fromEntries(manifest.configFields.flatMap((field) => field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]]));
}

function withUnavailableWorkspaceProviders(
  providers: WorkspaceProviderManifest[],
  initial?: ProjectDto,
): WorkspaceProviderManifest[] {
  const providerId = initial?.workspace.provider;
  return providerId && !providers.some((provider) => provider.id === providerId)
    ? [...providers, { id: providerId, name: providerId, configFields: [] }]
    : providers;
}

function withUnavailableManifests(manifests: IntegrationPluginManifest[], initial?: ProjectDto): IntegrationPluginManifest[] {
  const installed = new Set(manifests.map((manifest) => manifest.id));
  return [...manifests, ...Object.keys(initial?.integrations ?? {}).flatMap((id) => installed.has(id) ? [] : [{ id, name: id, configFields: [], secretFields: [] }])];
}

function validateIntegrations(
  project: ProjectFormValue,
  manifests: IntegrationPluginManifest[],
  secretValues: Record<string, Record<string, string>>,
): { pluginId: string; fieldKey: string; message: string } | undefined {
  for (const manifest of manifests) {
    const integration = project.integrations[manifest.id];
    if (!integration?.enabled) continue;
    for (const field of manifest.configFields) {
      if (!isConfigFieldVisible(field, manifest.configFields, integration.config)) continue;
      const value = integration.config[field.key] ?? field.defaultValue;
      if (field.type === "string[]") {
        const normalized = Array.isArray(value)
          ? value.map((entry) => entry.trim()).filter(Boolean)
          : [];
        if (field.required && normalized.length === 0) {
          return { pluginId: manifest.id, fieldKey: field.key, message: `请至少添加一个${field.label}` };
        }
        if (new Set(normalized).size !== normalized.length) {
          return { pluginId: manifest.id, fieldKey: field.key, message: `${field.label}不能重复` };
        }
      } else if (field.required && field.type === "string" && String(value ?? "").trim().length === 0) {
        return { pluginId: manifest.id, fieldKey: field.key, message: `请输入${field.label}` };
      }
    }
    for (const field of manifest.secretFields) {
      const draft = secretValues[manifest.id]?.[field.key] ?? "";
      if (field.required && !integration.secretConfigured[field.key] && draft.trim().length === 0) {
        return { pluginId: manifest.id, fieldKey: field.key, message: `请输入${field.label}` };
      }
    }
  }
  return undefined;
}

function normalizeIntegrations(
  integrations: ProjectFormValue["integrations"],
  manifests: IntegrationPluginManifest[],
): ProjectFormValue["integrations"] {
  const installed = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  return Object.fromEntries(Object.entries(integrations).map(([pluginId, integration]) => {
    const manifest = installed.get(pluginId);
    if (!manifest) return [pluginId, integration];
    const config = Object.fromEntries(manifest.configFields.flatMap((field) => {
      const value = integration.config[field.key] ?? field.defaultValue;
      if (field.type === "string") {
        const normalized = String(value ?? "").trim();
        return normalized ? [[field.key, normalized]] : [];
      }
      if (field.type === "string[]") {
        const normalized = Array.isArray(value)
          ? value.map((entry) => entry.trim()).filter(Boolean)
          : [];
        return normalized.length > 0 ? [[field.key, normalized]] : [];
      }
      return value === undefined ? [] : [[field.key, value]];
    }));
    return [pluginId, { ...integration, config }];
  }));
}

function collectSecretPatches(
  values: Record<string, Record<string, string>>,
): Record<string, Record<string, string | null>> {
  return Object.fromEntries(Object.entries(values).flatMap(([pluginId, fields]) => {
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.length > 0));
    return Object.keys(patch).length > 0 ? [[pluginId, patch]] : [];
  }));
}

function focusIntegrationField(form: HTMLFormElement | null, fieldKey: string) {
  if (!form) return;
  const wrapper = [...form.querySelectorAll<HTMLElement>("[data-config-key], [data-secret-key]")]
    .find((element) => element.dataset.configKey === fieldKey || element.dataset.secretKey === fieldKey);
  if (!wrapper) return;
  wrapper.closest("details")?.setAttribute("open", "");
  const control = wrapper.matches("input, button, [tabindex]")
    ? wrapper
    : wrapper.querySelector<HTMLElement>("input, button, [tabindex]");
  control?.focus();
}

function commandLabel(key: "install" | "test" | "start" | "acceptanceUrl"): string {
  return ({ install: "安装命令", test: "测试命令", start: "启动命令", acceptanceUrl: "验收 URL" })[key];
}

function setEvidenceCaptureMode(
  commands: ProjectFormValue["commands"],
  mode: EvidenceCaptureMode,
): ProjectFormValue["commands"] {
  if (mode === "agent") {
    const { evidenceCapture: _capture, ...rest } = commands;
    return rest;
  }
  const shared = {
    label: commands.evidenceCapture?.label ?? "验收证据",
    timeoutMs: commands.evidenceCapture?.timeoutMs ?? 15_000,
  };
  const evidenceCapture = mode === "browser"
    ? { mode, ...shared }
    : mode === "electron"
      ? {
          mode,
          ...shared,
          electronEntry: commands.evidenceCapture?.mode === "electron"
            ? commands.evidenceCapture.electronEntry
            : "",
        }
      : {
          mode,
          ...shared,
          command: commands.evidenceCapture?.mode === "command"
            ? commands.evidenceCapture.command
            : "",
        };
  return { ...commands, evidenceCapture };
}

function updateEvidenceCapture(
  commands: ProjectFormValue["commands"],
  patch: { label?: string; timeoutMs?: number },
): ProjectFormValue["commands"] {
  return commands.evidenceCapture
    ? { ...commands, evidenceCapture: { ...commands.evidenceCapture, ...patch } }
    : commands;
}

function normalizeCommands(
  commands: ProjectFormValue["commands"],
): ProjectFormValue["commands"] {
  const normalized = Object.fromEntries(
    Object.entries(commands).filter(([key, value]) =>
      key === "evidenceCapture" || (typeof value === "string" && value.trim().length > 0)),
  ) as ProjectFormValue["commands"];
  const capture = commands.evidenceCapture;
  if (!capture) return normalized;
  const shared = {
    label: capture.label.trim(),
    ...(capture.timeoutMs ? { timeoutMs: capture.timeoutMs } : {}),
  };
  return {
    ...normalized,
    evidenceCapture: capture.mode === "browser"
      ? { mode: "browser", ...shared }
      : capture.mode === "electron"
        ? { mode: "electron", ...shared, electronEntry: capture.electronEntry.trim() }
        : { mode: "command", ...shared, command: capture.command.trim() },
  };
}
