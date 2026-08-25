import {
  buildTrayTaskModel,
  type TrayIssue,
  type TrayTaskSection,
} from "./tray-task-model.js";

export interface TrayMenuEntry {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  click?: () => void;
}

interface TrayMenuControllerOptions<Menu> {
  loadIssues(): Promise<TrayIssue[]>;
  buildMenu(template: TrayMenuEntry[]): Menu;
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

export class TrayMenuController<Menu> {
  private opening?: Promise<void>;

  constructor(private readonly options: TrayMenuControllerOptions<Menu>) {}

  open(): Promise<void> {
    this.opening ??= this.loadAndOpen().finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async loadAndOpen(): Promise<void> {
    let taskArea: TrayMenuEntry[];
    try {
      taskArea = buildTaskArea(
        await this.options.loadIssues(),
        this.options.openIssue,
        this.options.openAll,
      );
    } catch {
      taskArea = [{ label: "任务列表暂不可用", enabled: false }];
    }

    const menu = this.options.buildMenu([
      ...taskArea,
      { type: "separator" },
      { label: "打开全部 Issues", click: this.options.openAll },
      { label: "退出 Oh My Bug", click: this.options.quit },
    ]);
    this.options.popUp(menu);
  }
}

function sectionEntries(
  heading: string,
  section: TrayTaskSection,
  openIssue: (issueId: string) => void,
  openAll: () => void,
): TrayMenuEntry[] {
  if (section.total === 0) return [];
  return [
    { label: `${heading} (${section.total})`, enabled: false },
    ...section.items.map((item) => ({
      label: item.label,
      click: () => openIssue(item.id),
    })),
    ...(section.overflow > 0
      ? [{ label: `还有 ${section.overflow} 条…`, click: openAll }]
      : []),
  ];
}

function buildTaskArea(
  issues: TrayIssue[],
  openIssue: (issueId: string) => void,
  openAll: () => void,
): TrayMenuEntry[] {
  const model = buildTrayTaskModel(issues);
  const attention = sectionEntries("需要你操作", model.attention, openIssue, openAll);
  const processing = sectionEntries("AI 处理中", model.processing, openIssue, openAll);
  if (!attention.length && !processing.length) {
    return [{ label: "暂无待处理任务", enabled: false }];
  }
  return [
    ...attention,
    ...(attention.length && processing.length ? [{ type: "separator" as const }] : []),
    ...processing,
  ];
}
