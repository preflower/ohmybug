import * as React from "react";

import { cn } from "../../lib/utils.js";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

function KbdShortcut({
  className,
  keyName,
  ...props
}: React.ComponentProps<"kbd"> & { keyName: string }) {
  const modifier = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

  return (
    <KbdGroup aria-hidden="true" className={className} {...props}>
      <Kbd>{modifier}</Kbd>
      <span data-slot="kbd-separator">+</span>
      <Kbd>{keyName}</Kbd>
    </KbdGroup>
  );
}

export { Kbd, KbdGroup, KbdShortcut };
