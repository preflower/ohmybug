import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "../../theme/theme-context.js";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return <Sonner
    closeButton
    richColors
    theme={resolvedTheme}
    position="bottom-right"
    toastOptions={{ duration: 5_000 }}
    {...props}
  />;
}
