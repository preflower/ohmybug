import * as React from "react";

import { cn } from "../../lib/utils.js";

function Textarea({
  className,
  invalid,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-20 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-120 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
