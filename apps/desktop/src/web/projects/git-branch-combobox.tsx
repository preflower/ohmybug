import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import type { WorkspaceBranchDiscoveryDto } from "../api/types.js";
import { Button } from "../components/ui/button.js";

interface GitBranchComboboxProps {
  value: string;
  discovery: WorkspaceBranchDiscoveryDto;
  onChange(value: string): void;
  onRefresh(): Promise<WorkspaceBranchDiscoveryDto>;
}

interface BranchGroup {
  value: "local" | "remote";
  label: string;
  items: string[];
}

export function GitBranchCombobox({
  value,
  discovery: initialDiscovery,
  onChange,
  onRefresh,
}: GitBranchComboboxProps) {
  const [refreshed, setRefreshed] = useState<{
    source: WorkspaceBranchDiscoveryDto;
    value: WorkspaceBranchDiscoveryDto;
  }>();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const discovery = refreshed?.source === initialDiscovery
    ? refreshed.value
    : initialDiscovery;

  const groups = useMemo<BranchGroup[]>(() => [
    { value: "local", label: "本地分支", items: discovery.localBranches },
    { value: "remote", label: "远程分支", items: discovery.remoteBranches },
  ].filter((group) => group.items.length > 0) as BranchGroup[], [discovery]);

  const refreshBranches = async () => {
    if (loading) return;
    setLoading(true);
    try {
      setRefreshed({ source: initialDiscovery, value: await onRefresh() });
    } catch (error) {
      setRefreshed({
        source: initialDiscovery,
        value: {
          ...discovery,
          refreshError: error instanceof Error ? error.message : "远程分支加载失败",
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return <Combobox.Root
    items={groups}
    onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen && !open) void refreshBranches();
    }}
    onValueChange={(nextValue) => {
      if (typeof nextValue === "string") onChange(nextValue);
    }}
    open={open}
    value={value}
  >
    <Combobox.InputGroup className="flex h-8 w-full items-center rounded-md border border-input bg-background outline-none transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      <Combobox.Input
        aria-label="基线分支"
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
      />
      <Combobox.Trigger
        aria-label="打开基线分支"
        className="grid h-full w-8 shrink-0 place-content-center text-muted-foreground outline-none"
      >
        <ChevronDown aria-hidden="true" size={14} />
      </Combobox.Trigger>
    </Combobox.InputGroup>
    <Combobox.Portal>
      <Combobox.Positioner align="start" className="isolate z-50" sideOffset={4}>
        <Combobox.Popup className="relative isolate z-50 max-h-[min(320px,var(--available-height))] w-[var(--anchor-width)] min-w-56 overflow-y-auto rounded-md border border-border bg-[var(--surface-raised)] text-foreground shadow-[0_12px_32px_rgb(0_0_0/24%)]">
          <Combobox.List className="p-1">
            <Combobox.Collection>
              {(group: BranchGroup) => <Combobox.Group items={group.items} key={group.value}>
                <Combobox.GroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                </Combobox.GroupLabel>
                <Combobox.Collection>
                  {(branch: string) => <Combobox.Item
                    className="relative flex min-h-[30px] cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 font-mono text-[13px] outline-none data-highlighted:bg-muted"
                    key={branch}
                    value={branch}
                  >
                    <span className="min-w-0 truncate">{branch}</span>
                    <Combobox.ItemIndicator className="absolute right-2 grid size-4 place-content-center">
                      <Check aria-hidden="true" size={13} strokeWidth={2.5} />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>}
                </Combobox.Collection>
              </Combobox.Group>}
            </Combobox.Collection>
            {loading ? <div className="px-2 py-2 text-xs text-muted-foreground" role="status">
              正在加载远程分支…
            </div> : null}
            {!loading && discovery.refreshError ? <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-destructive">
              <span>{discovery.refreshError}</span>
              <Button size="sm" type="button" variant="ghost" onClick={() => { void refreshBranches(); }}>
                <RefreshCw aria-hidden="true" size={13} />重试
              </Button>
            </div> : null}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  </Combobox.Root>;
}
