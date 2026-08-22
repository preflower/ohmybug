// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IntegrationPluginManifest, ProjectDto } from "../../src/web/api/types.js";
import {
  ProjectList,
} from "../../src/web/projects/project-list.js";
import {
  filterAndSortProjects,
  formatProjectUpdatedAt,
  integrationName,
} from "../../src/web/projects/project-list-model.js";

const now = Date.parse("2026-08-22T06:00:00.000Z");

const manifests: IntegrationPluginManifest[] = [
  { id: "sentry", name: "Sentry", configFields: [], secretFields: [] },
  { id: "dingtalk", name: "DingTalk", configFields: [], secretFields: [] },
];

const projects: ProjectDto[] = [
  {
    id: "project-storefront",
    key: "STOREFRONT",
    name: "storefront",
    path: "~/Documents/Workspace/storefront",
    agent: { plugin: "codex" },
    integrations: {},
    workspace: { provider: "local", config: {} },
    revision: 3,
    createdAt: "2026-08-10T06:00:00.000Z",
    updatedAt: "2026-08-21T06:00:00.000Z",
  },
  {
    id: "project-ohmybug",
    key: "OHMYBUG",
    name: "ohmybug",
    path: "~/Documents/Workspace/ohmybug",
    agent: { plugin: "codex" },
    integrations: {
      sentry: { enabled: true, config: {}, secretConfigured: {} },
      dingtalk: { enabled: true, config: {}, secretConfigured: {} },
    },
    workspace: { provider: "git", config: { baseBranch: "main", delivery: "local" } },
    revision: 8,
    createdAt: "2026-08-16T06:00:00.000Z",
    updatedAt: "2026-08-22T05:59:40.000Z",
  },
  {
    id: "project-logistics",
    key: "LOGISTICS",
    name: "logistics-core",
    path: "~/Documents/Workspace/logistics-core",
    agent: { plugin: "codex" },
    integrations: {
      dingtalk: { enabled: true, config: {}, secretConfigured: {} },
    },
    workspace: { provider: "local", config: {} },
    revision: 5,
    createdAt: "2026-08-14T06:00:00.000Z",
    updatedAt: "2026-08-22T05:42:00.000Z",
  },
];

describe("Projects engineering table", () => {
  it("renders truthful project columns and relative update times", () => {
    render(<ProjectList manifests={manifests} now={now} projects={projects} onEdit={() => undefined} />);

    const screenRegion = screen.getByRole("region", { name: "本机项目" });
    expect(screenRegion).toHaveAttribute("data-testid", "projects-list-screen");
    expect(within(screenRegion).getByRole("heading", { name: "本机项目" })).toBeVisible();
    expect(within(screenRegion).getByText("3", { selector: ".projects-count" })).toBeVisible();
    for (const label of ["项目", "本机路径", "Agent", "集成", "最近更新"]) {
      expect(within(screenRegion).getByText(label, { selector: ".project-table-column" })).toBeVisible();
    }

    expect(within(screenRegion).getByText("ohmybug")).toBeVisible();
    expect(within(screenRegion).getByText("OHMYBUG")).toBeVisible();
    expect(within(screenRegion).getByText("~/Documents/Workspace/ohmybug")).toBeVisible();
    expect(within(screenRegion).getAllByText("Codex")).toHaveLength(3);
    expect(within(screenRegion).getByText("Sentry")).toBeVisible();
    expect(within(screenRegion).getAllByText("DingTalk")).toHaveLength(2);
    expect(within(screenRegion).getByText("未启用")).toBeVisible();
    expect(within(screenRegion).getByText("刚刚")).toBeVisible();
    expect(within(screenRegion).getByText("18 分钟前")).toBeVisible();
    expect(within(screenRegion).getByText("昨天")).toBeVisible();
    expect(within(screenRegion).getByText("项目与配置仅保存在本机；Oh My Bug 只会在已添加项目的目录内运行 Agent。")).toBeVisible();
  });

  it("filters by project identity and opens the exact project", () => {
    const onEdit = vi.fn();
    render(<ProjectList manifests={manifests} now={now} projects={projects} onEdit={onEdit} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索项目" }), {
      target: { value: "store" },
    });

    expect(screen.getByRole("button", { name: /打开项目 storefront/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /打开项目 ohmybug/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /打开项目 storefront/ }));
    expect(onEdit).toHaveBeenCalledWith(projects[0]);
  });

  it("sorts without mutating Runtime order and formats stable relative time", () => {
    const original = [...projects];

    expect(filterAndSortProjects(projects, "", "updated").map((project) => project.name)).toEqual([
      "ohmybug",
      "logistics-core",
      "storefront",
    ]);
    expect(filterAndSortProjects(projects, "", "name").map((project) => project.name)).toEqual([
      "logistics-core",
      "ohmybug",
      "storefront",
    ]);
    expect(projects).toEqual(original);
    expect(formatProjectUpdatedAt("2026-08-22T05:59:40.000Z", now)).toBe("刚刚");
    expect(formatProjectUpdatedAt("2026-08-22T05:42:00.000Z", now)).toBe("18 分钟前");
    expect(formatProjectUpdatedAt("2026-08-21T06:00:00.000Z", now)).toBe("昨天");
    expect(integrationName("dingtalk", new Map())).toBe("DingTalk");
  });
});
