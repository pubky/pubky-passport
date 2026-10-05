import { type ComponentPropsWithoutRef, type ReactNode, useLayoutEffect, useRef } from "react";

import { CircleAlertIcon, CircleInfoIcon, TriangleAlertIcon } from "./icons";
import { cn } from "./mergeClassNames";

type NoticeTone = "error" | "warning" | "info";

const TONES = {
  error: {
    icon: <CircleAlertIcon className="mt-0.5 text-destructive-text" size={16} />,
    role: "alert",
    surface: "border-destructive-text/40 bg-destructive/10",
  },
  warning: {
    icon: <TriangleAlertIcon className="mt-0.5 text-warning" size={16} />,
    role: "status",
    surface: "border-warning/40 bg-warning/10",
  },
  info: {
    icon: <CircleInfoIcon className="mt-0.5 text-muted-foreground" size={16} />,
    role: "status",
    surface: "border-border bg-secondary/40",
  },
} as const satisfies Record<NoticeTone, { icon: ReactNode; role: string; surface: string }>;

/**
 * A message about a whole screen or form rather than one field: a failed step (`error`), a risk
 * to weigh before acting (`warning`) or context (`info`). Errors are alerts, the others polite
 * status messages. `focusOnMount` moves focus to the notice when it appears, so a failure the
 * person just caused is read out and the next Tab continues from it instead of the page top.
 */
function Notice({
  children,
  className,
  focusOnMount = false,
  role,
  tone,
  ...props
}: ComponentPropsWithoutRef<"div"> & { focusOnMount?: boolean; tone: NoticeTone }) {
  const notice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (focusOnMount) notice.current?.focus();
  }, [focusOnMount]);
  const { icon, role: toneRole, surface } = TONES[tone];
  return (
    <div
      className={cn(
        "flex min-w-0 gap-3 rounded-xl border p-4 text-sm leading-5 text-foreground",
        surface,
        className,
      )}
      data-tone={tone}
      ref={notice}
      role={role ?? toneRole}
      tabIndex={focusOnMount ? -1 : undefined}
      {...props}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">{children}</div>
    </div>
  );
}

export { Notice, type NoticeTone };
