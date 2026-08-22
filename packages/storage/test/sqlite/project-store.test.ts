import { describe, expect, it } from "vitest";

import { createStore, now, project } from "../helpers.js";

describe("SQLite project store", () => {
  it("lists projects by key and normalizes initial revision timestamps", () => {
    const store = createStore();
    store.registerProject({ ...project, id: "project-z", key: "ZZZ" });
    store.registerProject({ ...project, id: "project-a", key: "AAA" });

    expect(store.listProjects()).toEqual([
      expect.objectContaining({ id: "project-a", key: "AAA", revision: 1, createdAt: now, updatedAt: now }),
      expect.objectContaining({ id: "project-z", key: "ZZZ", revision: 1, createdAt: now, updatedAt: now }),
    ]);
    store.close();
  });

  it("updates projects with compare-and-swap revision protection", () => {
    const store = createStore();
    store.registerProject({ ...project, name: "Original" });
    const current = store.getProject(project.id)!;
    const updated = store.updateProject({ ...current, name: "Payments" }, current.revision!);

    expect(updated).toMatchObject({ name: "Payments", revision: 2, updatedAt: now });
    expect(store.getProject(project.id)).toEqual(updated);
    expect(() => store.updateProject({ ...updated, name: "Stale" }, current.revision!))
      .toThrow("CONCURRENT_UPDATE");
    store.close();
  });
});
