import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
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
import type { ConfigValue, IntegrationPluginManifest, ProjectDto, ProjectInspection, WorkspaceProviderManifest } from "../api/types.js";
import { ConfigFields } from "./config-fields.js";
import { IntegrationFields } from "./integration-fields.js";

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
  onSave(project: ProjectFormValue): Promise<ProjectDto | void>;
  onSaveSecrets?(projectId: string, pluginId: string, patch: Record<string, string | null>): Promise<ProjectDto>;
}

type ProjectField = "name" | "key" | "path";
type Feedback = { saving: boolean; error: string; message: string };

const localWorkspaceProvider: WorkspaceProviderManifest = {
  id: "local",
  name: "本机目录",
  configFields: [],
};

export function ProjectForm({ manifests, workspaceProviders = [localWorkspaceProvider], initial, inspection, onCancel, onSelectDirectory, onSave, onSaveSecrets }: ProjectFormProps) {
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
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(Boolean(initial));
  const [saveConfirmed, setSaveConfirmed] = useState(false);

  useEffect(() => {
    if (!inspection) return;
    setProjectInspection(inspection);
    setProject((current) => ({
      ...current,
      workspace: mergeWorkspaceInspection(current.workspace, inspection),
    }));
  }, [inspection]);

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
    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      const normalized = { ...project, key: project.key.trim().toUpperCase() };
      const next = await onSave(normalized);
      setProject(next
        ? initialValue(allManifests, allWorkspaceProviders, next, projectInspection)
        : normalized);
      setSaved(true);
      setSaveConfirmed(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存项目失败");
    } finally {
      setSaving(false);
    }
  };

  const saveSecrets = async (manifest: IntegrationPluginManifest) => {
    if (!project.id || !onSaveSecrets) return;
    const patch = Object.fromEntries(Object.entries(secretValues[manifest.id] ?? {}).filter(([, value]) => value.length > 0));
    setFeedback((current) => ({ ...current, [manifest.id]: { saving: true, error: "", message: "" } }));
    try {
      const next = await onSaveSecrets(project.id, manifest.id, patch);
      setProject(initialValue(allManifests, allWorkspaceProviders, next));
      setSecretValues((current) => ({ ...current, [manifest.id]: {} }));
      setFeedback((current) => ({ ...current, [manifest.id]: { saving: false, error: "", message: "凭证已保存到系统钥匙串" } }));
    } catch (error) {
      setFeedback((current) => ({ ...current, [manifest.id]: { saving: false, error: error instanceof Error ? error.message : "保存凭证失败", message: "" } }));
    }
  };

  return <form className="project-form" data-testid="project-settings-form" id="project-settings-form" noValidate onSubmit={submit} ref={formRef}>
    <Tabs className="project-settings-tabs" orientation="vertical" value={activeTab} onValueChange={setActiveTab}>
      <TabsList aria-label="项目配置" className="project-settings-nav" variant="line">
        <span className="project-settings-nav-label" role="presentation">项目设置</span>
        <TabsTrigger value="project">项目</TabsTrigger>
        <TabsTrigger value="agent">Agent</TabsTrigger>
        <TabsTrigger value="commands">命令与验收</TabsTrigger>
        <span className="project-settings-nav-label project-settings-nav-label-integrations" role="presentation">集成</span>
        {allManifests.map((manifest) => <TabsTrigger key={manifest.id} value={manifest.id}>{manifest.name}</TabsTrigger>)}
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
          <ConfigFields fields={allWorkspaceProviders.find((provider) => provider.id === project.workspace.provider)?.configFields ?? []} config={project.workspace.config} idPrefix={`workspace-${project.workspace.provider}`} inspection={projectInspection?.workspaces[project.workspace.provider]} onChange={(key, value) => updateProject((current) => ({ ...current, workspace: { ...current.workspace, config: { ...current.workspace.config, [key]: value } } }))} />
          {initial?.workspace?.unavailable ? <p className="field-wide">{initial.workspace.unavailable}</p> : null}
          {projectInspection?.workspaces[project.workspace.provider]?.available === false ? <p className="field-wide field-error">{projectInspection.workspaces[project.workspace.provider]?.reason}</p> : null}
        </div></section><section className="workspace-permission"><h3>工作目录权限</h3><p>Agent 对文件的所有读写操作都将被限制在此项目目录中。</p></section></section></div> : null}
        {activeTab === "agent" ? <div className="flex-1 text-sm outline-none" role="tabpanel"><section className="project-settings-panel"><div className="section-heading"><div><h2>Agent</h2><p>选择能力实现，并提供项目指令。</p></div></div><div className="form-grid">
          <label>Agent 插件<Select items={{ codex: "Codex", ...(project.agentPlugin === "codex" ? {} : { [project.agentPlugin]: project.agentPlugin }) }} value={project.agentPlugin} onValueChange={(agentPlugin) => {
            if (agentPlugin !== null) updateProject((current) => ({ ...current, agentPlugin }));
          }}><SelectTrigger aria-label="Agent 插件"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="codex">Codex</SelectItem>{project.agentPlugin !== "codex" ? <SelectItem value={project.agentPlugin}>{project.agentPlugin}</SelectItem> : null}</SelectContent></Select></label>
          <label className="field-wide">项目指令<Textarea aria-label="项目指令" rows={4} value={project.instructions} onChange={(event) => updateProject((current) => ({ ...current, instructions: event.target.value }))} /></label>
        </div></section></div> : null}
        {activeTab === "commands" ? <div className="flex-1 text-sm outline-none" role="tabpanel"><section className="project-settings-panel"><div className="section-heading"><div><h2>命令与验收</h2><p>这些命令会作为项目上下文提供给 Agent。</p></div></div><div className="form-grid">{(["install", "test", "start", "acceptanceUrl"] as const).map((key) => <label key={key}>{commandLabel(key)}<Input value={project.commands[key] ?? ""} onChange={(event) => updateProject((current) => ({ ...current, commands: { ...current.commands, [key]: event.target.value || undefined } }))} /></label>)}</div></section></div> : null}
        {allManifests.map((manifest) => {
          const value = project.integrations[manifest.id] ?? { enabled: false, config: {}, secretConfigured: {} };
          const state = feedback[manifest.id] ?? { saving: false, error: "", message: "" };
          const unavailable = initial?.integrations?.[manifest.id]?.unavailable;
          return activeTab === manifest.id ? <div className="flex-1 text-sm outline-none" key={manifest.id} role="tabpanel"><section className="project-settings-panel">
            <div className="section-heading integration-heading"><div><h2>{manifest.name}</h2>{unavailable ? <p>{unavailable}</p> : null}</div><label className="switch-row"><Checkbox checked={value.enabled} disabled={Boolean(unavailable)} onCheckedChange={(checked) => updateProject((current) => ({
              ...current,
              integrations: {
                ...current.integrations,
                [manifest.id]: { ...value, enabled: Boolean(checked) },
              },
            }))} />启用</label></div>
            <IntegrationFields
              manifest={manifest}
              config={value.config}
              secretConfigured={value.secretConfigured}
              secretValues={secretValues[manifest.id] ?? {}}
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
              onSecretChange={(key, secretValue) => setSecretValues((current) => ({
                ...current,
                [manifest.id]: { ...current[manifest.id], [key]: secretValue },
              }))}
            />
            {project.id && manifest.secretFields.length > 0 ? <div className="credential-save-block"><Button disabled={state.saving || !onSaveSecrets} size="sm" type="button" variant="outline" onClick={() => { void saveSecrets(manifest); }}>{state.saving ? "保存中…" : `保存 ${manifest.name} 凭证`}</Button>{state.error ? <Alert variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert> : null}{state.message ? <p role="status">{state.message}</p> : null}</div> : null}
          </section></div> : null;
        })}
      </div><footer className="project-settings-actions"><div className="project-settings-status">{saved ? <span aria-live="polite" role={saveConfirmed ? "status" : undefined}><i className="state-dot" />所有更改已保存</span> : <span>有未保存的更改</span>}</div><div className="project-settings-action-buttons">{onCancel ? <Button type="button" variant="secondary" onClick={onCancel}>取消</Button> : null}<Button disabled={saving} type="submit">{saving ? "保存中…" : "保存项目"}</Button></div>{saveError ? <Alert className="project-save-alert" variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert> : null}</footer></div>
    </Tabs>
  </form>;
}

function initialValue(manifests: IntegrationPluginManifest[], workspaceProviders: WorkspaceProviderManifest[], initial?: ProjectDto, inspection?: ProjectInspection): ProjectFormValue {
  const integrations = Object.fromEntries(manifests.map((manifest) => {
    const stored = initial?.integrations?.[manifest.id];
    return [manifest.id, { enabled: stored?.enabled ?? false, config: stored?.config ?? defaults(manifest), secretConfigured: stored?.secretConfigured ?? {} }];
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

function mergeWorkspaceInspection(
  workspace: ProjectFormValue["workspace"],
  inspection: ProjectInspection,
): ProjectFormValue["workspace"] {
  const providerInspection = inspection.workspaces[workspace.provider];
  return {
    ...workspace,
    config: {
      ...normalizeWorkspaceConfig(workspace.provider, workspace.config),
      ...(providerInspection?.configPatch ?? {}),
    },
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

function commandLabel(key: "install" | "test" | "start" | "acceptanceUrl"): string {
  return ({ install: "安装命令", test: "测试命令", start: "启动命令", acceptanceUrl: "验收 URL" })[key];
}
