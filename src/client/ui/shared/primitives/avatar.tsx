import type { ComponentPropsWithoutRef } from "react";
import Image from "next/image";

import { keyColor } from "@/client/ui/shared/identityDisplay";
import { cn } from "@/client/ui/shared/mergeClassNames";

type AvatarProps = ComponentPropsWithoutRef<"span"> & {
  fallback: string;
  size?: "sm" | "md" | "lg";
  src?: string | undefined;
  /**
   * The public key of an identity without a profile name. Without a picture it then shows a person
   * glyph on a colour picked from the key, instead of initials of a placeholder name: identities
   * without a profile differ at a glance.
   */
  unnamedKey?: string | undefined;
};

const sizes = { sm: "size-10 text-sm", md: "size-12 text-base", lg: "size-24 text-2xl" };

function Avatar({
  className,
  fallback,
  size = "md",
  src,
  style,
  unnamedKey,
  ...props
}: AvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-bold text-secondary-foreground",
        sizes[size],
        unnamedKey && "text-foreground",
        className,
      )}
      data-unnamed={unnamedKey ? "" : undefined}
      style={unnamedKey ? { backgroundColor: keyColor(unnamedKey), ...style } : style}
      {...props}
    >
      {unnamedKey ? (
        <svg
          aria-hidden="true"
          className="size-1/2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="8" r="5" />
          <path d="M20 21a8 8 0 0 0-16 0" />
        </svg>
      ) : (
        <span aria-hidden="true">{fallback.slice(0, 2).toUpperCase()}</span>
      )}
      {src ? (
        <Image
          key={src}
          alt=""
          className="object-cover"
          fill
          loading="eager"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          sizes="96px"
          src={src}
          unoptimized
        />
      ) : null}
    </span>
  );
}

export { Avatar };
