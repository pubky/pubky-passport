import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

type AvatarProps = ComponentPropsWithoutRef<"span"> & { fallback: string; size?: "sm" | "md" | "lg"; src?: string };

const sizes = { sm: "size-10 text-sm", md: "size-12 text-base", lg: "size-24 text-2xl" };

function Avatar({ className, fallback, size = "md", src, style, ...props }: AvatarProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-bold text-muted-foreground", sizes[size], className)} style={{ backgroundImage: src ? `url(${src})` : undefined, backgroundPosition: "center", backgroundSize: "cover", ...style }} {...props}>
      {!src && fallback.slice(0, 2).toUpperCase()}
    </span>
  );
}

export { Avatar };
