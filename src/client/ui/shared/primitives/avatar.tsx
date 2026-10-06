import { useState, type ComponentPropsWithoutRef } from "react";
import Image from "next/image";

import { cn } from "@/client/ui/shared/mergeClassNames";
import { FacehashAvatar } from "./facehashAvatar";

type AvatarProps = ComponentPropsWithoutRef<"span"> & {
  size?: "sm" | "md" | "lg";
  src?: string | undefined;
} & (
    | {
        /**
         * A pubky's key. Without a picture, or with one the browser cannot draw, the avatar is
         * pubky.app's face for this key (see `FacehashAvatar`).
         */
        publicKey: string;
        /** The pubky's profile name, whose initial the face shows as its mouth. */
        profileName?: string | undefined;
        fallback?: undefined;
      }
    | {
        /** A name that is not a pubky's (a Google account), whose initials stand in for a picture. */
        fallback: string;
        publicKey?: undefined;
        profileName?: undefined;
      }
  );

const sizes = { sm: "size-10 text-sm", md: "size-12 text-base", lg: "size-24 text-2xl" };

function Avatar({
  className,
  fallback,
  profileName,
  publicKey,
  size = "md",
  src,
  ...props
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const picture = src && src !== failedSrc ? src : undefined;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-secondary-foreground",
        sizes[size],
        className,
      )}
      {...props}
    >
      {picture ? (
        <Image
          key={picture}
          alt=""
          className="object-cover"
          fill
          loading="eager"
          onError={() => setFailedSrc(picture)}
          sizes="96px"
          src={picture}
          unoptimized
        />
      ) : publicKey ? (
        <FacehashAvatar profileName={profileName} publicKey={publicKey} />
      ) : (
        <span aria-hidden="true" className="font-bold">
          {fallback?.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

export { Avatar };
