import type { ProjectDto } from "../api/types.js";

export type ProjectSort = "updated" | "name";

export function filterAndSortProjects(
  projects: ProjectDto[],
  query: string,
  sort: ProjectSort,
): ProjectDto[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? projects.filter((project) => [project.name, project.key, project.path]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery)))
    : projects;

  return [...filtered].sort((left, right) => {
    if (sort === "name") {
      return (left.name ?? left.key).localeCompare(right.name ?? right.key, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updated !== 0) return updated;
    return (left.name ?? left.key).localeCompare(right.name ?? right.key, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function formatProjectUpdatedAt(updatedAt: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(updatedAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return "昨天";
  return new Date(updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function integrationName(id: string, manifests: Map<string, string>): string {
  const manifestName = manifests.get(id);
  if (manifestName) return manifestName;
  if (id.toLocaleLowerCase() === "dingtalk") return "DingTalk";
  if (id.toLocaleLowerCase() === "sentry") return "Sentry";
  return id;
}
