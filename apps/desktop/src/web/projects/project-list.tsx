import { ChevronRight, FolderKanban, Search } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type { IntegrationPluginManifest, ProjectDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import {
  filterAndSortProjects,
  formatProjectUpdatedAt,
  integrationName,
  type ProjectSort,
} from "./project-list-model.js";

const projectListReferenceTime = Date.now();

function agentName(project: ProjectDto): string {
  const plugin = project.agent?.plugin ?? "codex";
  return plugin === "codex" ? "Codex" : plugin;
}

export function ProjectList({
  manifests,
  now = projectListReferenceTime,
  projects,
  onEdit,
}: {
  manifests: IntegrationPluginManifest[];
  now?: number;
  projects: ProjectDto[];
  onEdit(project: ProjectDto): void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("updated");
  const manifestNames = useMemo(
    () => new Map(manifests.map((manifest) => [manifest.id, manifest.name])),
    [manifests],
  );
  const visibleProjects = useMemo(
    () => filterAndSortProjects(projects, query, sort),
    [projects, query, sort],
  );

  return (
    <section
      aria-labelledby="projects-list-heading"
      className="projects-layout"
      data-testid="projects-list-screen"
      role="region"
    >
      <div className="projects-heading">
        <h2 id="projects-list-heading">本机项目</h2>
        <span className="projects-count">{projects.length}</span>
      </div>
      <div className="projects-list-toolbar">
        <label className="project-search">
          <Search aria-hidden="true" size={15} />
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select
          value={sort}
          onValueChange={(value) => setSort(value === "name" ? "name" : "updated")}
        >
          <SelectTrigger aria-label="项目排序" className="project-sort">
            <SelectValue>{sort === "updated" ? "最近更新" : "项目名称"}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="updated">最近更新</SelectItem>
            <SelectItem value="name">项目名称</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="project-table">
        <div aria-hidden="true" className="project-table-header">
          <span className="project-table-column">项目</span>
          <span className="project-table-column">本机路径</span>
          <span className="project-table-column">Agent</span>
          <span className="project-table-column">集成</span>
          <span className="project-table-column">最近更新</span>
          <span />
        </div>
        <div className="project-table-rows">
          {visibleProjects.map((project, index) => {
            const name = project.name ?? project.key;
            const integrations = Object.entries(project.integrations ?? {})
              .filter(([, integration]) => integration.enabled)
              .map(([id]) => integrationName(id, manifestNames));
            return (
              <Button
                aria-label={`打开项目 ${name}，${project.path}`}
                className="project-table-row h-auto w-full"
                key={project.id}
                type="button"
                variant="ghost"
                onClick={() => onEdit(project)}
              >
                <span className="project-table-identity">
                  <span aria-hidden="true" className={`project-mark project-mark-${index % 3}`} />
                  <span>
                    <strong>{name}</strong>
                    <code>{project.key}</code>
                  </span>
                </span>
                <code className="project-table-path">{project.path}</code>
                <span className="project-table-agent">{agentName(project)}</span>
                <span className="project-integrations">
                  {integrations.length ? integrations.map((integration) => (
                    <span className="project-integration" key={integration}>
                      <span aria-hidden="true" className="integration-dot" />
                      {integration}
                    </span>
                  )) : <span className="project-integration-empty">未启用</span>}
                </span>
                <time className="project-table-updated" dateTime={project.updatedAt}>
                  {formatProjectUpdatedAt(project.updatedAt, now)}
                </time>
                <ChevronRight aria-hidden="true" className="project-table-chevron" size={15} />
              </Button>
            );
          })}
          {visibleProjects.length === 0 ? (
            <p className="project-search-empty">没有匹配的项目</p>
          ) : null}
        </div>
      </div>
      <p className="projects-local-note">
        <FolderKanban aria-hidden="true" size={15} />
        项目与配置仅保存在本机；Oh My Bug 只会在已添加项目的目录内运行 Agent。
      </p>
    </section>
  );
}
