import {
  Activity,
  Bug,
  ChevronLeft,
  CircleDot,
  FolderKanban,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Sparkles
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import appIconUrl from "../../assets/icons/oh-my-bug.png";
import type { TrayNavigationTarget } from "../electron/desktop-api.js";
import { isTerminalIssueStatus } from "../shared/issue-status.js";
import { api } from "./api/client.js";
import type { DirectorySelection, ProductTransport } from "./api/transport.js";
import type { BranchInfoDto, IntegrationPluginManifest, IssueDto, IssueWorkspaceInfoDto, ProjectDto, ProjectInspection, WorkspaceProviderManifest } from "./api/types.js";
import { CommandMenu } from "./command/command-menu.js";
import { Button } from "./components/ui/button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { NewIssueDialog } from "./dialogs/new-issue-dialog.js";
import { IssueDetail } from "./issues/issue-detail.js";
import { IssueStatusBadge } from "./issues/issue-status.js";
import { AgentActivity } from "./issues/agent-activity.js";
import { completedBranchFromEvents } from "./issues/completed-branch.js";
import { newestIssuesFirst } from "./issues/issue-order.js";
import { useIssueEvents } from "./issues/use-issue-events.js";
import { useIssueListUpdates } from "./issues/use-issue-list-updates.js";
import {
  SHORTCUTS,
  ariaKeyShortcuts,
  isEditableShortcutTarget,
  matchesShortcut,
} from "./keyboard/shortcuts.js";
import { ProjectList } from "./projects/project-list.js";
import { ProjectForm, type ProjectFormValue } from "./projects/project-form.js";
import { KeyboardShortcutOverview } from "./settings/keyboard-shortcuts.js";
import { ThemeSelector } from "./settings/theme-selector.js";
import { ThemeProvider } from "./theme/theme-provider.js";

type View = "issues" | "projects" | "settings";

function viewFromPath(pathname: string): View {
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/settings")) return "settings";
  return "issues";
}

function isDesktopRenderer(): boolean {
  return Boolean(window.ohMyBug);
}

function currentRoute(): string {
  if (!isDesktopRenderer()) return window.location.pathname;
  return window.location.hash.slice(1) || "/issues";
}

function routeHref(view: View): string {
  return isDesktopRenderer() ? `#/${view}` : `/${view}`;
}

function writeRoute(view: View, replace = false): void {
  const path = `/${view}`;
  if (isDesktopRenderer()) {
    if (window.location.hash !== `#${path}`) {
      if (replace) window.history.replaceState({}, "", `#${path}`);
      else window.location.hash = path;
    }
    return;
  }
  if (window.location.pathname === path) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <AppContent />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const [view, setView] = useState<View>(() => viewFromPath(currentRoute()));
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [manifests, setManifests] = useState<IntegrationPluginManifest[]>([]);
  const [workspaceProviders, setWorkspaceProviders] = useState<WorkspaceProviderManifest[]>([]);
  const [issues, setIssues] = useState<IssueDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedIssue, setSelectedIssue] = useState<IssueDto>();
  const [projectEditor, setProjectEditor] = useState<ProjectDto | "new">();
  const [projectInspection, setProjectInspection] = useState<ProjectInspection>();
  const [loaded, setLoaded] = useState(false);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [health, setHealth] = useState<Record<string, { state: string; lastError?: string; nextRetryAt?: string }>>({});
  const [error, setError] = useState("");
  const traySelection = useRef<string | undefined>(undefined);
  const canCreateIssue = loaded && projects.length > 0;

  const selectProjectDirectory = useCallback(async (): Promise<DirectorySelection> => {
    setError("");
    try {
      return await api.openProjectDirectory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法打开项目目录");
      return { canceled: true };
    }
  }, []);

  const openProjectDirectory = useCallback(async () => {
    writeRoute("projects");
    setView("projects");
    setProjectEditor(undefined);
    setProjectInspection(undefined);
    const selection = await selectProjectDirectory();
    if (selection.canceled) return;
    setProjectInspection(selection.inspection);
    setProjectEditor("new");
  }, [selectProjectDirectory]);

  useEffect(() => {
    let active = true;
    if (!projectEditor || projectEditor === "new") return () => { active = false; };
    void api.inspectProject(projectEditor.path).then((next) => {
      if (active) setProjectInspection(next);
    }).catch(() => {
      if (active) setProjectInspection(undefined);
    });
    return () => { active = false; };
  }, [projectEditor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, SHORTCUTS.dismissTransient)) {
        setNewIssueOpen(false);
        setCommandOpen(false);
        return;
      }
      if (isEditableShortcutTarget(event.target)) return;
      if (matchesShortcut(event, SHORTCUTS.openCommandMenu)) {
        event.preventDefault();
        setCommandOpen(true);
      } else if (canCreateIssue && matchesShortcut(event, SHORTCUTS.createIssue)) {
        event.preventDefault();
        setNewIssueOpen(true);
      } else if (matchesShortcut(event, SHORTCUTS.openProject)) {
        event.preventDefault();
        setCommandOpen(false);
        void openProjectDirectory();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCreateIssue, openProjectDirectory]);

  useEffect(() => {
    const onRouteChange = () => {
      const nextView = viewFromPath(currentRoute());
      setView(nextView);
      if (nextView !== "issues") setActiveProjectId(undefined);
      setProjectEditor(undefined);
      setProjectInspection(undefined);
    };
    const eventName = isDesktopRenderer() ? "hashchange" : "popstate";
    window.addEventListener(eventName, onRouteChange);
    return () => window.removeEventListener(eventName, onRouteChange);
  }, []);

  useEffect(() => window.ohMyBug?.onTrayNavigation?.((target: TrayNavigationTarget) => {
    writeRoute("issues");
    setView("issues");
    setActiveProjectId(undefined);
    setProjectEditor(undefined);
    setProjectInspection(undefined);
    traySelection.current = target.issueId;
    setSelectedId(target.issueId);
    setSelectedIssue(undefined);
  }) ?? (() => undefined), []);

  const updateIssue = useCallback((issue: IssueDto) => {
    setSelectedIssue((current) =>
      issue.id === selectedId
        && (current?.id !== issue.id || issue.revision >= current.revision)
        ? issue
        : current
    );
    setIssues((current) => newestIssuesFirst(current.map((entry) =>
      entry.id === issue.id && issue.revision >= entry.revision ? issue : entry
    )));
  }, [selectedId]);

  const refreshIssue = useCallback(async () => {
    if (!selectedId) return;
    updateIssue(await api.issue(selectedId));
  }, [selectedId, updateIssue]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.integrationPlugins(),
      api.workspaceProviders().catch(() => [{ id: "local", name: "本机目录", configFields: [] }]),
      api.projects(),
      api.issues(),
      api.integrationHealth(),
    ])
      .then(([nextManifests, nextWorkspaceProviders, nextProjects, nextIssues, nextHealth]) => {
        if (!active) return;
        const orderedIssues = newestIssuesFirst(nextIssues);
        setManifests(nextManifests);
        setWorkspaceProviders(nextWorkspaceProviders);
        setProjects(nextProjects);
        setIssues(orderedIssues);
        setSelectedId((current) => current ?? orderedIssues[0]?.id);
        setHealth(nextHealth);
        setLoaded(true);
        if (nextProjects.length === 0) {
          setView("projects");
          setProjectEditor(undefined);
          setProjectInspection(undefined);
          writeRoute("projects", true);
        }
      })
      .catch((caught) => {
        if (active) {
          setLoaded(true);
          setError(caught instanceof Error ? caught.message : "控制中心连接失败");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const fromTray = traySelection.current === selectedId;
    void api
      .issue(selectedId)
      .then((next) => {
        if (fromTray) traySelection.current = undefined;
        if (fromTray && isTerminalIssueStatus(next.status)) {
          setSelectedId(undefined);
          setSelectedIssue(undefined);
          return;
        }
        updateIssue(next);
      })
      .catch((caught) => {
        if (fromTray) {
          traySelection.current = undefined;
          setSelectedId(undefined);
          setSelectedIssue(undefined);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Issue 加载失败");
      });
  }, [selectedId, updateIssue]);

  const goTo = (next: View) => {
    writeRoute(next);
    setView(next);
    if (next === "issues") setActiveProjectId(undefined);
    setProjectEditor(undefined);
    setProjectInspection(undefined);
  };

  const goToProjectIssues = (projectId: string) => {
    goTo("issues");
    setActiveProjectId(projectId);
    const nextIssue = issues.find((issue) => issue.projectId === projectId);
    setSelectedId(nextIssue?.id);
    setSelectedIssue((current) => current?.id === nextIssue?.id ? current : undefined);
  };

  const navigate = (next: View) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    goTo(next);
  };

  const rememberProject = (saved: ProjectDto) => {
    setProjects((current) => {
      const exists = current.some((project) => project.id === saved.id);
      return exists ? current.map((project) => (project.id === saved.id ? saved : project)) : [...current, saved];
    });
    setProjectEditor(saved);
  };

  const saveProject = async (value: ProjectFormValue) => {
    const saved = value.id ? await api.updateProject(value.id, value) : await api.createProject(value);
    rememberProject(saved);
    return saved;
  };

  const saveProjectSecrets = async (projectId: string, pluginId: string, patch: Record<string, string | null>) => {
    const saved = await api.saveIntegrationSecrets(projectId, pluginId, patch);
    rememberProject(saved);
    return saved;
  };

  const pageTitle = view === "issues" ? "Issues" : view === "projects" ? "Projects" : "Settings";
  const projectEditing = view === "projects" && Boolean(projectEditor);
  const viewTitle = projectEditing ? "项目配置" : pageTitle;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const visibleIssues = activeProjectId
    ? issues.filter((issue) => issue.projectId === activeProjectId)
    : issues;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img alt="" className="brand-mark" draggable="false" src={appIconUrl} /><span className="brand-name">Oh My Bug ?!</span></div>
        {canCreateIssue ? <NewIssueDialog open={newIssueOpen} preferredProjectId={activeProjectId} projects={projects} trigger={<Button aria-label="新建 Issue" className="new-issue" type="button"><span>新建 Issue</span><Plus aria-hidden="true" size={14} /></Button>} onOpenChange={setNewIssueOpen} onCreated={(issue) => { setIssues((current) => newestIssuesFirst([...current, issue])); setSelectedId(issue.id); setSelectedIssue(issue); goTo("issues"); }} /> : null}
        <nav aria-label="主导航" className="nav-list">
          <a aria-label="Issues" aria-current={view === "issues" && !activeProjectId ? "page" : undefined} className="nav-item" href={routeHref("issues")} onClick={navigate("issues")}><CircleDot aria-hidden="true" size={15} strokeWidth={1.7} /><span>Issues</span></a>
          <a aria-label="Projects" aria-current={view === "projects" ? "page" : undefined} className="nav-item" href={routeHref("projects")} onClick={navigate("projects")}><FolderKanban aria-hidden="true" size={15} strokeWidth={1.7} /><span>Projects</span></a>
          <a aria-label="Settings" aria-current={view === "settings" ? "page" : undefined} className="nav-item" href={routeHref("settings")} onClick={navigate("settings")}><Settings aria-hidden="true" size={15} strokeWidth={1.7} /><span>Settings</span></a>
        </nav>
        <div className="sidebar-section">
          <p className="sidebar-label">Projects</p>
          {projects.map((project) => <Button aria-current={view === "issues" && activeProjectId === project.id ? "page" : undefined} className="nav-item" key={project.id} type="button" variant="ghost" onClick={() => goToProjectIssues(project.id)}><span className="project-dot" /><span>{project.name ?? project.key}</span></Button>)}
          {loaded && projects.length === 0 ? <Button className="nav-item" type="button" variant="ghost" onClick={() => goTo("projects")}><span className="project-dot" /><span>打开本机项目</span></Button> : null}
        </div>
        <div className="sidebar-footer"><div className="agent-mode"><Activity size={13} /><span>Codex</span><i /></div></div>
      </aside>

      <main className="main-area">
        <header className="location-header">
          <div className="breadcrumb"><Bug aria-hidden="true" size={14} /><strong>{pageTitle}</strong><span>/</span><span>{view === "issues" ? activeProject?.name ?? activeProject?.key ?? "全部" : view === "projects" ? projectEditor && projectEditor !== "new" ? projectEditor.name ?? projectEditor.key : "本机项目" : "运行环境"}</span></div>
          <div className="system-state"><span className={`state-dot ${error ? "state-dot-error" : ""}`} /><span>{error || "Codex 已连接"}</span></div>
        </header>
        {view !== "issues" ? <header className="view-header">
          <h1>{viewTitle}</h1>
          <div className="filters">
            {!projectEditing && view === "projects" && projects.length > 0 ? <div className="header-actions"><Button size="sm" type="button" variant="secondary" onClick={() => { setProjectInspection(undefined); setProjectEditor("new"); }}>高级：手动输入路径</Button><Button size="sm" type="button" onClick={() => void openProjectDirectory()}><Plus size={13} />打开项目目录</Button></div> : null}
          </div>
        </header> : null}

        {view === "issues" ? (
          <IssueWorkspace issues={visibleIssues} projects={projects} selected={selectedIssue} selectedId={selectedId} onSelect={setSelectedId} onDeselect={() => { setSelectedId(undefined); setSelectedIssue(undefined); }} onRefresh={refreshIssue} onUpdated={updateIssue} />
        ) : view === "projects" ? (
          <ProjectsWorkspace
            editor={projectEditor}
            inspection={projectInspection}
            manifests={manifests}
            workspaceProviders={workspaceProviders}
            projects={projects}
            onEdit={(editor) => { setProjectInspection(undefined); setProjectEditor(editor); }}
            onOpenProjectDirectory={openProjectDirectory}
            onSelectProjectDirectory={selectProjectDirectory}
            onManualProject={() => { setProjectInspection(undefined); setProjectEditor("new"); }}
            onRefreshWorkspaceBranches={(path, providerId) => api.projectBranches(path, providerId, true)}
            onSave={saveProject}
            onSaveSecrets={saveProjectSecrets}
          />
        ) : <SettingsWorkspace health={health} />}
      </main>

      <CommandMenu open={commandOpen} canCreateIssue={canCreateIssue} onOpenChange={setCommandOpen} onNewIssue={() => setNewIssueOpen(true)} onOpenProject={() => void openProjectDirectory()} />
    </div>
  );
}

function IssueWorkspace({ issues, projects, selected, selectedId, onSelect, onDeselect, onRefresh, onUpdated }: {
  issues: IssueDto[];
  projects: ProjectDto[];
  selected?: IssueDto;
  selectedId?: string;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onRefresh: () => Promise<void>;
  onUpdated: (issue: IssueDto) => void;
}) {
  const action = (operation: Promise<IssueDto>) => operation.then(onUpdated);
  const [branches, setBranches] = useState<Record<string, BranchInfoDto>>({});
  const [workspaceResult, setWorkspaceResult] = useState<{
    issue: IssueDto;
    info: IssueWorkspaceInfoDto;
  }>();
  useEffect(() => {
    let active = true;
    if (!selected) return () => { active = false; };
    const issue = selected;
    void api.issueWorkspace(selected.id).then((info) => {
      if (active) setWorkspaceResult({ issue, info });
    }).catch(() => {
      if (active) setWorkspaceResult({ issue, info: null });
    });
    return () => { active = false; };
  }, [selected]);
  const workspaceInfo = selected
    && workspaceResult?.issue === selected
    ? workspaceResult.info
    : null;
  const approveDelivery = (issue: IssueDto) => api.approveDelivery(issue.id).then((result) => {
    onUpdated(result.issue);
    if (result.branch) {
      setBranches((current) => ({ ...current, [issue.id]: result.branch! }));
    }
  });
  useIssueListUpdates(issues, selectedId, onUpdated);
  const events = useIssueEvents(selectedId, onRefresh);
  const durableBranch = completedBranchFromEvents(events);
  const selectedBranch = selected
    ? branches[selected.id] ?? durableBranch
    : undefined;
  const active = selected ? [
    "ASSESSING",
    "REPAIRING",
    "EVIDENCE_CAPTURE",
    "EVIDENCE_CHECK",
    "FINALIZATION_RECOVERY",
  ].includes(selected.status) : false;
  const [metadataOpen, setMetadataOpen] = useState(true);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !selected
        || isEditableShortcutTarget(event.target)
        || event.repeat
        || !matchesShortcut(event, SHORTCUTS.toggleIssueDetails)
      ) return;
      event.preventDefault();
      setMetadataOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);
  const selectedProject = selected ? projects.find((project) => project.id === selected.projectId) : undefined;
  return <>
    <header className="view-header">
      <h1>Issues</h1>
      <div className="filters">
        {selected && !metadataOpen ? <MetadataRailToggle open={false} onToggle={() => setMetadataOpen(true)} /> : null}
      </div>
    </header>
    <section className={`workspace ${selected ? "has-selection" : ""} ${metadataOpen && selected ? "metadata-open" : "metadata-closed"}`} aria-label="Issue 工作区">
    <section className="issue-pane" aria-label="Issue 列表">
      <div className="issue-pane-heading"><span>当前 Issues</span><span>{issues.length}</span></div>
      {issues.length ? <div className="issue-list">{issues.map((issue) => <Button aria-current={issue.id === selectedId ? "true" : undefined} className="issue-row h-auto w-full" key={issue.id} type="button" variant="ghost" onClick={() => onSelect(issue.id)}><span className="issue-row-top"><code>{issue.identifier}</code><IssueStatusBadge status={issue.status} recoveryKind={issue.finalizationRecovery?.context?.recoveryKind} recoveryStep={issue.finalizationRecovery?.diagnostic?.step} /></span><strong>{issue.title}</strong><small>{issue.inputs.at(-1)?.integration ?? "manual"} · {new Date(issue.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></Button>)}</div> : <div className="empty-list"><div><CircleDot aria-hidden="true" size={18} strokeWidth={1.5} /><h2>暂无 Issue</h2><p>手动创建，或为项目连接 Sentry 与 DingTalk。</p></div></div>}
    </section>
    <section className={`detail-pane ${selected ? "detail-pane-scroll" : ""}`} aria-label={selected ? "Issue 详情" : "开始使用"}>
      {selected ? <><div className="mobile-detail-toolbar"><Button type="button" variant="ghost" onClick={onDeselect}><ChevronLeft aria-hidden="true" size={15} />返回 Issue 列表</Button></div><IssueDetail branch={selectedBranch} issue={selected} onRefresh={onRefresh} onApproveAssessment={(input) => action(api.approveAssessment(selected.id, input))} onConfirmNotABug={(reference) => action(api.confirmNotABug(selected.id, reference))} onConfirmDuplicate={(reference, duplicateOf) => action(api.confirmDuplicate(selected.id, reference, duplicateOf))} onRequestReassessment={(feedback) => action(api.requestReassessment(selected.id, feedback))} onRejectDelivery={(feedback) => action(api.rejectDelivery(selected.id, feedback))} onApproveDelivery={() => approveDelivery(selected)} onCancel={() => action(api.cancel(selected.id))} onRetry={() => action(api.retry(selected.id))} onRebuildSession={() => action(api.rebuildSession(selected.id, selected.revision))} onGrantCapabilities={(expectedRevision, requestId) => action(api.grantIssueCapabilities(selected.id, expectedRevision, requestId))} /></> : <Welcome />}
    </section>
    {selected && metadataOpen ? <IssueMetadataRail active={active} events={events} issue={selected} project={selectedProject} workspace={workspaceInfo} onClose={() => setMetadataOpen(false)} /> : null}
    </section>
  </>;
}

function IssueMetadataRail({ active, events, issue, project, workspace, onClose }: {
  active: boolean;
  events: Parameters<typeof AgentActivity>[0]["events"];
  issue: IssueDto;
  project?: ProjectDto;
  workspace: IssueWorkspaceInfoDto;
  onClose: () => void;
}) {
  const latestInput = issue.inputs.at(-1);
  const timestamp = (value: string) => new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return <aside className="issue-metadata-rail" data-testid="issue-metadata-rail" aria-label="Issue 详情栏">
    <header className="metadata-rail-header">
      <span>详情</span>
      <MetadataRailToggle open onToggle={onClose} />
    </header>
    <dl className="issue-metadata-list">
      <div><dt>项目</dt><dd><span className="project-dot" />{project?.name ?? project?.key ?? issue.projectId}</dd></div>
      {workspace?.branch ? <div className="issue-workspace-row"><dt>分支</dt><dd><code title={workspace.branch}>{workspace.branch}</code>{workspace.providerId === "git" ? <span className="workspace-kind-tag">Worktree</span> : null}</dd></div> : null}
      <div><dt>来源</dt><dd>{latestInput?.integration ?? "manual"}</dd></div>
      <div><dt>状态</dt><dd><IssueStatusBadge status={issue.status} recoveryKind={issue.finalizationRecovery?.context?.recoveryKind} recoveryStep={issue.finalizationRecovery?.diagnostic?.step} /></dd></div>
      <div><dt>Agent 会话</dt><dd><code>{issue.agentSession?.sessionId ?? "尚未创建"}</code></dd></div>
      <div><dt>创建时间</dt><dd><time>{timestamp(issue.createdAt)}</time></dd></div>
      <div><dt>更新时间</dt><dd><time>{timestamp(issue.updatedAt)}</time></dd></div>
    </dl>
    <AgentActivity active={active} events={events} />
  </aside>;
}

function MetadataRailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "隐藏详情栏" : "显示详情栏";
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.toggleIssueDetails)}
            aria-label={label}
            className={open ? "metadata-rail-toggle" : undefined}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={onToggle}
          >
            <Icon aria-hidden="true" size={15} />
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Welcome() {
  const flow = [["判断与分析", "Agent 区分 Bug、Feature 或无需改动", "Assessment 确认"], ["实现与验证", "Agent 自循环实现并提交可视化证据", "Delivery 确认"], ["完成", "验收通过后直接关闭 Issue", "完成"]] as const;
  return <div className="welcome"><div className="welcome-kicker"><Sparkles aria-hidden="true" size={14} />本地 AI 改动实现</div><h2>从 Integration Input 到可验证交付</h2><p>Agent 负责分析与实现；Runtime 负责编排、会话、证据与两次明确确认。</p><div className="flow-preview">{flow.map(([title, description, gate], index) => <div className="flow-step" key={title}><span className="flow-step-number">0{index + 1}</span><div><strong>{title}</strong><span>{description}</span></div><span className="gate-chip">{gate}</span></div>)}</div></div>;
}

function ProjectsWorkspace({ projects, manifests, workspaceProviders, editor, inspection, onEdit, onOpenProjectDirectory, onSelectProjectDirectory, onManualProject, onRefreshWorkspaceBranches, onSave, onSaveSecrets }: {
  projects: ProjectDto[];
  manifests: IntegrationPluginManifest[];
  workspaceProviders: WorkspaceProviderManifest[];
  editor?: ProjectDto | "new";
  inspection?: ProjectInspection;
  onEdit: (project: ProjectDto | "new" | undefined) => void;
  onOpenProjectDirectory: () => Promise<void>;
  onSelectProjectDirectory: () => Promise<DirectorySelection>;
  onManualProject: () => void;
  onRefreshWorkspaceBranches: (
    path: string,
    providerId: string,
  ) => ReturnType<ProductTransport["projectBranches"]>;
  onSave: (project: ProjectFormValue) => Promise<ProjectDto | void>;
  onSaveSecrets: (projectId: string, pluginId: string, patch: Record<string, string | null>) => Promise<ProjectDto>;
}) {
  const previousEditor = useRef(editor);
  const [formSession, setFormSession] = useState(0);

  useEffect(() => {
    const previous = previousEditor.current;
    const sameSavedProject = previous && previous !== "new" && editor && editor !== "new" && previous.id === editor.id;
    const completedFirstSave = previous === "new" && editor && editor !== "new";
    if (previous !== editor && !sameSavedProject && !completedFirstSave) {
      setFormSession((current) => current + 1);
    }
    previousEditor.current = editor;
  }, [editor]);

  if (editor) {
    const initial = editor === "new" ? undefined : editor;
    return <section className="page-scroll project-editor-page" data-testid="project-config-screen"><div className="settings-column"><ProjectForm key={`${formSession}:${inspection?.path ?? "pending"}`} initial={initial} inspection={inspection} manifests={manifests} workspaceProviders={workspaceProviders} onCancel={() => onEdit(undefined)} onSelectDirectory={onSelectProjectDirectory} onRefreshWorkspaceBranches={onRefreshWorkspaceBranches} onSave={onSave} onSaveSecrets={onSaveSecrets} /></div></section>;
  }
  return <section className="projects-page">{projects.length ? <ProjectList manifests={manifests} projects={projects} onEdit={onEdit} /> : <div className="page-empty"><FolderKanban size={24} /><h2>打开第一个本机项目</h2><p>选择一个本机目录，然后确认 Agent 与可插拔集成配置。</p><div className="onboarding-actions"><Button type="button" onClick={() => void onOpenProjectDirectory()}>打开项目目录</Button><Button type="button" variant="secondary" onClick={onManualProject}>高级：手动输入路径</Button></div></div>}</section>;
}

function SettingsWorkspace({ health }: { health: Record<string, { state: string; lastError?: string; nextRetryAt?: string }> }) {
  const entries = Object.entries(health);
  return (
    <section className="settings-page">
      <div className="settings-card">
        <h2>集成运行状态</h2>
        {entries.length ? (
          <ul className="health-list">
            {entries.map(([id, value]) => (
              <li key={id}>
                <span className={`state-dot ${value.state === "backoff" || value.state === "disconnected" ? "state-dot-error" : ""}`} />
                <code>{id}</code>
                <strong>{value.state}</strong>
                {value.lastError ? <span>{value.lastError}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p>尚未启用集成插件。</p>}
      </div>
      <section aria-labelledby="preferences-heading" className="settings-card preferences-card">
        <h2 id="preferences-heading">偏好设置</h2>
        <div className="settings-list">
          <div className="settings-option">
            <div>
              <h3>外观</h3>
              <p>显式主题会覆盖系统外观设置，并保存在当前浏览器中。</p>
            </div>
            <ThemeSelector />
          </div>
          <KeyboardShortcutOverview />
        </div>
      </section>
    </section>
  );
}
