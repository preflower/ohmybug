import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

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
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture = await registerProject(page, String(Date.now()));
  try {
    await page.reload();
    const sentryManifest = await page.evaluate(async () => (
      window as unknown as Window & {
        ohMyBug: { listIntegrationPlugins(): Promise<Array<Record<string, unknown>>> };
      }
    ).ohMyBug.listIntegrationPlugins().then((plugins) =>
      plugins.find((plugin) => plugin.id === "sentry")
    ));
    expect(sentryManifest).toMatchObject({
      sections: expect.arrayContaining([expect.objectContaining({
        id: "filters",
        summary: expect.objectContaining({ separator: " · " }),
      })]),
    });
    await page.getByRole("link", { name: "Projects" }).click();
    await page.locator(".project-table-row").filter({ hasText: fixture.name }).click();
    await expect(page.getByLabel("本机项目路径")).toHaveValue(fixture.repository);
    await expect(page.getByLabel("项目标识")).toHaveValue(fixture.key);
    await expect(page.getByRole("tablist", { name: "项目配置" })).toHaveAttribute("aria-orientation", "vertical");
    await page.getByRole("tab", { name: "Sentry" }).click();
    await expect(page.getByRole("heading", { name: "连接配置" })).toBeVisible();
    await expect(page.locator("details").filter({ hasText: "过滤规则" })).toContainText(
      "全部环境 · 未解决 Issue",
    );
    await expect(page.getByLabel("Auth token")).toBeVisible();
    await expect(page.getByText("需要 event:read 权限；请勿填写 DSN。")).toBeVisible();
    await page.getByRole("textbox", { name: /^Organization\b/ }).fill("acme");
    await page.getByRole("textbox", { name: /^Project\b/ }).fill("checkout");
    await page.getByLabel("Auth token").fill("must-not-leak");
    await page.getByRole("button", { name: "保存更改" }).click();
    await expect(page.getByText("所有更改已保存")).toBeVisible();
    await page.getByRole("button", { name: "测试已保存配置" }).click();
    const connectionStatus = page.locator(".integration-connection-test-result");
    await expect(connectionStatus).toHaveAttribute("data-state", "success");
    await expect(connectionStatus).toContainText("连接成功");
    await expect(connectionStatus).toContainText("acme");
    await expect(connectionStatus).toContainText("checkout");
    await expect(page.locator("body")).not.toContainText("must-not-leak");
    const response = await page.evaluate(async () => JSON.stringify(await (
      window as unknown as Window & { ohMyBug: { listProjects(): Promise<unknown> } }
    ).ohMyBug.listProjects()));
    expect(response).not.toContain("must-not-leak");
    expect(response).toContain('"token":true');

    const focusOrder = [
      page.getByRole("checkbox", { name: "启用" }),
      page.getByRole("textbox", { name: /^Organization\b/ }),
      page.getByRole("textbox", { name: /^Project\b/ }),
      page.getByRole("button", { name: "替换 Auth token" }),
      page.getByRole("button", { name: "测试已保存配置" }),
      page.locator("details").filter({ hasText: "过滤规则" }).locator("summary"),
      page.getByRole("button", { name: "取消" }),
      page.getByRole("button", { name: "保存更改" }),
    ];
    await focusOrder[0]!.focus();
    for (const next of focusOrder.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
    }

    const outputDir = resolve(".artifacts", "visual-diff", "sentry-settings");
    await mkdir(outputDir, { recursive: true });
    const settings = page.locator(".project-settings-tabs");
    await settings.screenshot({ path: resolve(outputDir, "dark-1536x1024.png") });

    await page.emulateMedia({ colorScheme: "light" });
    const contrastRatios = await connectionStatus.locator("h4, dt, dd, footer").evaluateAll((nodes) => {
      const parse = (value: string) => {
        const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
      };
      const blend = (foreground: number[], background: number[]) => {
        const alpha = foreground[3] ?? 1;
        return foreground.slice(0, 3).map((channel, index) =>
          channel * alpha + (background[index] ?? 0) * (1 - alpha)
        );
      };
      const luminance = (color: number[]) => {
        const values = color.slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
      };
      const panel = nodes[0]!.closest(".integration-connection-test-result")!;
      const background = blend(
        parse(getComputedStyle(panel).backgroundColor),
        parse(getComputedStyle(document.body).backgroundColor),
      );
      return nodes.map((node) => {
        const foreground = parse(getComputedStyle(node).color);
        const lighter = Math.max(luminance(foreground), luminance(background));
        const darker = Math.min(luminance(foreground), luminance(background));
        return (lighter + 0.05) / (darker + 0.05);
      });
    });
    expect(Math.min(...contrastRatios)).toBeGreaterThanOrEqual(4.5);
    await settings.screenshot({ path: resolve(outputDir, "light-1536x1024.png") });

    await page.setViewportSize({ width: 720, height: 1024 });
    const narrowMetrics = await settings.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth);
    await settings.screenshot({ path: resolve(outputDir, "narrow-720x1024.png") });

    await page.setViewportSize({ width: 768, height: 512 });
    await expect(page.locator(".project-settings-nav")).toHaveCSS("border-bottom-width", "1px");
    await page.locator(".project-editor-page").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const zoomMetrics = await page.locator(".project-settings-content").evaluate((content) => {
      const result = content.querySelector(".integration-connection-test-result")!.getBoundingClientRect();
      const filters = content.querySelector(".integration-section-collapsed")!.getBoundingClientRect();
      const footer = document.querySelector(".project-settings-actions")!.getBoundingClientRect();
      return { resultBottom: result.bottom, filtersBottom: filters.bottom, footerTop: footer.top };
    });
    expect(zoomMetrics.resultBottom).toBeLessThanOrEqual(zoomMetrics.footerTop);
    expect(zoomMetrics.filtersBottom).toBeLessThanOrEqual(zoomMetrics.footerTop);
    await page.screenshot({ path: resolve(outputDir, "zoom-200-percent.png") });
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

test("renders streamlined DingTalk settings with one save action", async ({ page }) => {
  await page.setViewportSize({ width: 1806, height: 1076 });
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture = await registerProject(page, String(Date.now()));
  try {
    await page.getByRole("tab", { name: "DingTalk" }).click();
    await page.getByRole("checkbox", { name: "启用" }).click();
    await page.getByLabel("Client ID").fill("ding-client-id");
    await page.getByLabel("Client Secret").fill("ding-client-secret");
    await page.getByRole("button", { name: "添加群聊" }).click();
    await page.getByRole("textbox", { name: "群聊 ID 1", exact: true }).fill("cid-acceptance-group");

    await expect(page.getByRole("button", { name: "保存更改" })).toHaveCount(1);
    await page.getByRole("button", { name: "保存更改" }).click();
    await expect(page.getByText("所有更改已保存")).toBeVisible();
    await expect(page.getByText("已连接", { exact: true })).toBeVisible();
    await expect(page.getByText("已配置")).toHaveCount(2);
    await expect(page.locator("details").filter({ hasText: "高级设置" })).not.toHaveAttribute("open");

    await page.getByRole("textbox", { name: "群聊 ID 1", exact: true })
      .fill("dingtalk1234567890abcdef1234567890abcdef");
    await expect(page.getByText("有未保存的更改")).toBeVisible();
    await expect(page.getByText("接收范围")).toBeVisible();
    await expect(page.getByText("指定群聊", { exact: true })).toBeVisible();
    await page.locator(".integration-heading h2").click();

    const visualContract = await page.locator(".project-settings-tabs").evaluate((root) => {
      const css = (selector: string) => getComputedStyle(root.querySelector(selector)!);
      return {
        railWidth: Math.round(root.querySelector(".project-settings-nav")!.getBoundingClientRect().width),
        navRowHeight: Math.round(root.querySelector('[role="tab"]')!.getBoundingClientRect().height),
        titleSize: Number.parseFloat(css(".integration-heading h2").fontSize),
        inputHeight: Math.round(root.querySelector('[aria-label="群聊 ID 1"]')!.getBoundingClientRect().height),
        footerHeight: Math.round(root.querySelector(".project-settings-actions")!.getBoundingClientRect().height),
        footerButtonHeight: Math.round(root.querySelector<HTMLButtonElement>('.project-settings-actions [type="submit"]')!.getBoundingClientRect().height),
      };
    });
    expect(visualContract).toEqual({
      railWidth: 240,
      navRowHeight: 38,
      titleSize: 20,
      inputHeight: 32,
      footerHeight: 54,
      footerButtonHeight: 30,
    });

    const outputDir = resolve(".artifacts", "visual-diff", "dingtalk-settings");
    await mkdir(outputDir, { recursive: true });
    await page.locator(".project-settings-tabs").screenshot({ path: resolve(outputDir, "actual.png") });
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

test("uses the design-reference active surface for project settings navigation", async ({ page }) => {
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
        indicatorWidth: indicator.width,
      };
    };
    const probe = document.createElement("div");
    probe.style.background = "var(--surface-hover)";
    document.body.append(probe);
    const surfaceHover = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      primary: read(document.querySelector('[aria-current="page"]')!),
      settings: read(document.querySelector('[role="tab"][data-active]')!),
      surfaceHover,
    };
  });

  expect(selectedStyles.settings).toEqual({
    backgroundColor: selectedStyles.surfaceHover,
    color: selectedStyles.primary.color,
    indicatorColor: selectedStyles.primary.indicatorColor,
    indicatorLeft: "0px",
    indicatorWidth: "5px",
  });

  await page.setViewportSize({ width: 720, height: 900 });
  await expect(settingsSelection).toHaveCSS("background-color", selectedStyles.surfaceHover);
  expect(await settingsSelection.evaluate((element) => getComputedStyle(element, "::before").display)).toBe("none");
});

test("shows inline project validation instead of silently ignoring save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "高级：手动输入路径" }).click();
  await page.getByLabel("项目名称").fill("Broken checkout");
  await page.getByLabel("项目标识").fill("BROKEN");

  await page.getByTestId("project-settings-form")
    .getByRole("button", { name: "保存更改", exact: true })
    .click();

  await expect(page.getByText("请输入本机项目路径")).toBeVisible();
  await expect(page.getByRole("tab", { name: "项目" })).toHaveAttribute("data-active", "");
});
