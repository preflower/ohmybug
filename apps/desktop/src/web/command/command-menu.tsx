import {
  Command,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button.js";
import { KbdShortcut } from "../components/ui/kbd.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

interface CommandMenuProps {
  open: boolean;
  canCreateIssue: boolean;
  onOpenChange(open: boolean): void;
  onNewIssue(): void;
  onOpenProject(): void;
}

export function CommandMenu({
  open,
  canCreateIssue,
  onOpenChange,
  onNewIssue,
  onOpenProject,
}: CommandMenuProps) {
  const closeAfter = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="command-menu w-[min(520px,calc(100vw-32px))] gap-0 overflow-hidden p-0"
      >
        <header>
          <DialogTitle><Command aria-hidden="true" size={15} />命令菜单</DialogTitle>
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogClose
                  render={
                    <Button aria-label="关闭" size="icon-sm" type="button" variant="ghost">
                      <X aria-hidden="true" size={16} />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent>关闭</TooltipContent>
          </Tooltip>
        </header>
        <div className="command-list">
          {canCreateIssue ? (
            <Button className="w-full justify-start" type="button" variant="ghost" onClick={() => closeAfter(onNewIssue)}>
              <Plus aria-hidden="true" size={14} />
              <span>新建 Issue</span>
              <KbdShortcut keyName="N" />
            </Button>
          ) : null}
          <CommandAction
            icon={<FolderOpen aria-hidden="true" size={14} />}
            keyName="O"
            label="打开项目"
            onClick={() => closeAfter(onOpenProject)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommandAction({
  icon,
  keyName,
  label,
  onClick,
}: {
  icon: ReactNode;
  keyName: string;
  label: string;
  onClick(): void;
}) {
  return (
    <Button className="w-full justify-start" type="button" variant="ghost" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <KbdShortcut keyName={keyName} />
    </Button>
  );
}
