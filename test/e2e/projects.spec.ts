import { expect, test } from "./runtime-protocol-fixture.js";

import { registerProject } from "./project-fixture.js";

test("renders the project directory action as a primary button", async ({ page }) => {
  await page.goto("/projects");

  const openDirectory = page.getByRole("button", { name: "打开项目目录" });
  await expect(openDirectory).toHaveCSS("background-color", "rgb(113, 107, 255)");
  await expect(openDirectory).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(openDirectory).toHaveCSS("font-size", "13px");
  await expect(openDirectory).toHaveCSS("font-weight", "500");
});

test("registers a local project and renders built-in plugins from manifests", async ({ page }) => {
    const fixture = await registerProject(page, String(Date.now()));
  try {
    await page.reload();
    await page.getByRole("link", { name: "Projects" }).click();
    await page.locator(".project-table-row").filter({ hasText: fixture.name }).click();
    await expect(page.getByLabel("本机项目路径")).toHaveValue(fixture.repository);
    await expect(page.getByLabel("项目标识")).toHaveValue(fixture.key);
    await expect(page.getByRole("tablist", { name: "项目配置" })).toHaveAttribute("aria-orientation", "vertical");
    await page.getByRole("tab", { name: "Sentry" }).click();
    await expect(page.getByLabel("Auth token")).toBeVisible();
    await page.getByLabel("Auth token").fill("must-not-leak");
    await page.getByRole("button", { name: "保存 Sentry 凭证" }).click();
    await expect(page.getByText("凭证已保存到系统钥匙串")).toBeVisible();
    const response = await page.evaluate(async () => JSON.stringify(await (
      window as unknown as Window & { ohMyBug: { listProjects(): Promise<unknown> } }
    ).ohMyBug.listProjects()));
    expect(response).not.toContain("must-not-leak");
    expect(response).toContain('"token":true');
  } finally {
    await fixture.cleanup();
  }
});

test("renders populated projects as a dense engineering table", async ({ page }) => {
  const fixture = await registerProject(page, String(Date.now()));
  try {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.reload();
    await page.getByRole("link", { name: "Projects" }).click();

    const screen = page.getByTestId("projects-list-screen");
    const row = page.locator(".project-table-row").filter({ hasText: fixture.name });
    await expect(screen).toBeVisible();
    await expect(screen.getByRole("searchbox", { name: "搜索项目" })).toBeVisible();
    await expect(screen.getByRole("combobox", { name: "项目排序" })).toContainText("最近更新");
    await expect(page.locator(".project-card")).toHaveCount(0);
    await expect(row).toHaveCSS("display", "grid");

    const measure = async (locator: typeof screen) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("PROJECT_LIST_NOT_RENDERED");
      return { width: Math.round(box.width), height: Math.round(box.height) };
    };
    const [screenMetrics, rowMetrics] = await Promise.all([measure(screen), measure(row)]);
    expect(screenMetrics.width).toBeLessThanOrEqual(1192);
    expect(rowMetrics.height).toBeGreaterThanOrEqual(64);
    expect(rowMetrics.height).toBeLessThanOrEqual(70);

    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.locator(".project-table-header")).toBeHidden();
    await expect(row.locator(".project-table-path")).toBeVisible();
    await expect(row.locator(".project-integrations")).toBeVisible();
    const narrowMetrics = await screen.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth);
  } finally {
    await fixture.cleanup();
  }
});

test("keeps project settings flat across desktop and narrow layouts", async ({ page }) => {
  const fixture = await registerProject(page, String(Date.now()));
  try {
    const assertFlatWorkspace = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });

      const column = page.locator(".settings-column");
      const settings = page.locator(".project-settings-tabs");
      const navigation = page.locator(".project-settings-nav");

      await expect(settings).toHaveCSS("border-top-width", "0px");
      await expect(settings).toHaveCSS("border-radius", "0px");
      await expect(settings).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const bounds = await column.evaluate((element) => {
        const columnRect = element.getBoundingClientRect();
        const workspaceRect = element.closest(".page-scroll")!.getBoundingClientRect();
        return {
          leftInset: columnRect.left - workspaceRect.left,
          rightInset: workspaceRect.right - columnRect.right,
        };
      });
      expect(bounds).toEqual({ leftInset: 0, rightInset: 0 });

      if (width > 760) {
        await expect(navigation).toHaveCSS("border-right-width", "1px");
        await expect(navigation).toHaveCSS("border-bottom-width", "0px");
      } else {
        await expect(navigation).toHaveCSS("border-right-width", "0px");
        await expect(navigation).toHaveCSS("border-bottom-width", "1px");
      }
    };

    await assertFlatWorkspace(1280, 800);
    await assertFlatWorkspace(720, 900);
  } finally {
    await fixture.cleanup();
  }
});

test("fills the desktop project workspace without a trailing blank region", async ({ page }) => {
  await page.setViewportSize({ width: 1368, height: 1230 });
  await page.goto("/projects");
  await page.getByRole("button", { name: "高级：手动输入路径" }).click();

  const metrics = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(".page-scroll")!;
    const editor = document.querySelector<HTMLElement>(".project-settings-tabs")!;
    const navigation = document.querySelector<HTMLElement>(".project-settings-nav")!;
    const actions = document.querySelector<HTMLElement>(".project-settings-actions")!;
    const workspaceRect = workspace.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();

    return {
      editorBottomGap: Math.round(workspaceRect.bottom - editorRect.bottom),
      navigationBottomGap: Math.round(editorRect.bottom - navigation.getBoundingClientRect().bottom),
      actionsBottomGap: Math.round(editorRect.bottom - actions.getBoundingClientRect().bottom),
      pageOverflow: workspace.scrollHeight - workspace.clientHeight,
    };
  });

  expect(metrics).toEqual({
    editorBottomGap: 0,
    navigationBottomGap: 0,
    actionsBottomGap: 0,
    pageOverflow: 0,
  });
});

test("matches the project settings active tab to the primary navigation selection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");
  await page.getByRole("button", { name: "高级：手动输入路径" }).click();

  const settingsSelection = page.getByRole("tab", { name: "项目", exact: true });
  const selectedStyles = await page.evaluate(() => {
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      const indicator = getComputedStyle(element, "::before");
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        indicatorColor: indicator.backgroundColor,
        indicatorLeft: indicator.left,
      };
    };
    return {
      primary: read(document.querySelector('[aria-current="page"]')!),
      settings: read(document.querySelector('[role="tab"][data-active]')!),
    };
  });

  expect(selectedStyles.settings).toEqual(selectedStyles.primary);

  await page.setViewportSize({ width: 720, height: 900 });
  await expect(settingsSelection).toHaveCSS("background-color", selectedStyles.primary.backgroundColor);
  expect(await settingsSelection.evaluate((element) => getComputedStyle(element, "::before").display)).toBe("none");
});

test("shows inline project validation instead of silently ignoring save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "高级：手动输入路径" }).click();
  await page.getByLabel("项目名称").fill("Broken checkout");
  await page.getByLabel("项目标识").fill("BROKEN");

  await page.getByTestId("project-settings-form")
    .getByRole("button", { name: "保存项目", exact: true })
    .click();

  await expect(page.getByText("请输入本机项目路径")).toBeVisible();
  await expect(page.getByRole("tab", { name: "项目" })).toHaveAttribute("data-active", "");
});
