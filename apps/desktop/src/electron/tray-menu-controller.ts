import {
  buildTrayTaskModel,
  type TrayIssue,
  type TrayTaskIndicator,
  type TrayTaskSection,
} from "./tray-task-model.js";

export interface TrayMenuEntry<Icon = unknown> {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  icon?: Icon;
  click?: () => void;
}

interface TrayMenuControllerOptions<Menu, Icon> {
  loadIssues(): Promise<TrayIssue[]>;
  resolveTaskIcon(indicator: TrayTaskIndicator): Icon | undefined;
  buildMenu(template: TrayMenuEntry<Icon>[]): Menu;
  popUp(menu: Menu): void;
  openIssue(issueId: string): void;
  openAll(): void;
  quit(): void;
}

interface TrayEventSource {
  on(event: "click" | "right-click", listener: () => void): unknown;
}

interface OpenableTrayMenu {
  open(): Promise<void>;
}

export function installTrayMenuEvents(tray: TrayEventSource, menu: OpenableTrayMenu): void {
  const open = () => { void menu.open(); };
  tray.on("click", open);
  tray.on("right-click", open);
}

export class TrayMenuController<Menu, Icon = unknown> {
  private opening?: Promise<void>;

  constructor(private readonly options: TrayMenuControllerOptions<Menu, Icon>) {}

  open(): Promise<void> {
    this.opening ??= this.loadAndOpen().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async loadAndOpen(): Promise<void> {
    let taskArea: TrayMenuEntry<Icon>[];
    try {
      taskArea = buildTaskArea(
        await this.options.loadIssues(),
        this.options.openIssue,
        this.options.openAll,
        this.options.resolveTaskIcon,
      );
    } catch {
      taskArea = [{ label: "任务列表暂不可用", enabled: false }];
    }

    const menu = this.options.buildMenu([
      ...taskArea,
      { type: "separator" },
      { label: "打开全部 Issues", click: this.options.openAll },
      { label: "退出 Oh My Bug ?!", click: this.options.quit },
    ]);
    this.options.popUp(menu);
  }
}

function sectionEntries<Icon>(
  heading: string,
  section: TrayTaskSection,
  openIssue: (issueId: string) => void,
  openAll: () => void,
  resolveTaskIcon: (indicator: TrayTaskIndicator) => Icon | undefined,
): TrayMenuEntry<Icon>[] {
  if (section.total === 0) return [];
  return [
    { label: `${heading} (${section.total})`, enabled: false },
    ...section.items.map((item) => {
      const icon = resolveTaskIcon(item.indicator);
      return {
        label: item.label,
        ...(icon === undefined ? {} : { icon }),
        click: () => openIssue(item.id),
      };
    }),
    ...(section.overflow > 0
      ? [{ label: `还有 ${section.overflow} 条…`, click: openAll }]
      : []),
  ];
}

function buildTaskArea<Icon>(
  issues: TrayIssue[],
  openIssue: (issueId: string) => void,
  openAll: () => void,
  resolveTaskIcon: (indicator: TrayTaskIndicator) => Icon | undefined,
): TrayMenuEntry<Icon>[] {
  const model = buildTrayTaskModel(issues);
  const attention = sectionEntries(
    "需要你操作",
    model.attention,
    openIssue,
    openAll,
    resolveTaskIcon,
  );
  const processing = sectionEntries(
    "AI 处理中",
    model.processing,
    openIssue,
    openAll,
    resolveTaskIcon,
  );
  if (!attention.length && !processing.length) {
    return [{ label: "暂无待处理任务", enabled: false }];
  }
  return [
    ...attention,
    ...(attention.length && processing.length ? [{ type: "separator" as const }] : []),
    ...processing,
  ];
}
