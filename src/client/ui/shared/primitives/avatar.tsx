"use client";

import type { ComponentPropsWithoutRef } from "react";
import Image from "next/image";

import { cn } from "../mergeClassNames";

type AvatarProps = ComponentPropsWithoutRef<"span"> & { fallback: string; size?: "sm" | "md" | "lg"; src?: string };

const sizes = { sm: "size-10 text-sm", md: "size-12 text-base", lg: "size-24 text-2xl" };

function Avatar({ className, fallback, size = "md", src, style, ...props }: AvatarProps) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-bold text-muted-foreground", sizes[size], className)} style={style} {...props}>
      <span aria-hidden="true">{fallback.slice(0, 2).toUpperCase()}</span>
      {src ? <Image alt="" className="object-cover" fill onError={(event) => { event.currentTarget.hidden = true; }} sizes="96px" src={src} unoptimized /> : null}
    </span>
  );
}

export { Avatar };
