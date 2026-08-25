import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "../../lib/utils.js";

export function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props<string>) {
  return <RadioGroupPrimitive
    className={cn("grid gap-2", className)}
    data-slot="radio-group"
    {...props}
  />;
}

export function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props<string>) {
  return <RadioPrimitive.Root
    className={cn(
      "grid size-4 shrink-0 cursor-pointer place-content-center rounded-full border border-input bg-background outline-none transition-[border-color,box-shadow] duration-120 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 data-checked:border-primary disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    data-slot="radio-group-item"
    {...props}
  >
    <RadioPrimitive.Indicator
      className="size-2 rounded-full bg-primary"
      data-slot="radio-group-indicator"
    />
  </RadioPrimitive.Root>;
}
