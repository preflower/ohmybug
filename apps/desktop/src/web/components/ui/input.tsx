import * as React from "react";

import { cn } from "../../lib/utils.js";

function Input({
  className,
  invalid,
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-120 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      data-slot="input"
      {...props}
    />
  );
}

export { Input };
