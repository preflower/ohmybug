import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../../lib/utils.js";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return <SwitchPrimitive.Root
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border bg-muted outline-none transition-colors data-checked:bg-accent focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-50",
      className,
    )}
    data-slot="switch"
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-[var(--surface)] shadow-sm transition-transform data-checked:translate-x-[18px]" />
  </SwitchPrimitive.Root>;
}
