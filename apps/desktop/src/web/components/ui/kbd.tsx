import * as React from "react";

import type { KeyboardShortcut } from "../../keyboard/shortcuts.js";
import { shortcutKeys, shortcutText } from "../../keyboard/shortcuts.js";
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
  accessible = false,
  className,
  platform,
  shortcut,
  ...props
}: Omit<React.ComponentProps<"kbd">, "children"> & {
  accessible?: boolean;
  platform?: string;
  shortcut: KeyboardShortcut;
}) {
  const keys = shortcutKeys(shortcut, platform);
  return (
    <KbdGroup
      aria-hidden={accessible ? undefined : "true"}
      aria-label={accessible ? shortcutText(shortcut, platform) : undefined}
      className={className}
      {...props}
    >
      {keys.map((key, index) => (
        <React.Fragment key={`${shortcut.id}-${key}-${index}`}>
          {index > 0 ? <span data-slot="kbd-separator">+</span> : null}
          <Kbd>{key}</Kbd>
        </React.Fragment>
      ))}
    </KbdGroup>
  );
}

export { Kbd, KbdGroup, KbdShortcut };
