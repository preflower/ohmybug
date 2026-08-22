import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";

import { cn } from "../../lib/utils.js";

function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-4 shrink-0 cursor-pointer rounded-xs border border-input bg-background text-primary-foreground outline-none transition-[background-color,border-color,box-shadow] duration-120 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 data-checked:border-primary data-checked:bg-primary disabled:pointer-events-none disabled:cursor-default disabled:opacity-50",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="grid place-content-center"
        data-slot="checkbox-indicator"
      >
        <Check size={12} strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
