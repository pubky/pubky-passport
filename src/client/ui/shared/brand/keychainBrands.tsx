import Image from "next/image";

import { cn } from "../mergeClassNames";
import { PubkyBrandIcon } from "./pubkyBrandIcon";

/**
 * Pubky Ring and Bitkit, the two keychain apps that approve Pubky sign-ins. One request (one QR
 * code, one link) works with either, so Passport presents them together, never as two choices.
 */
export const KEYCHAIN_APPS = [
  {
    name: "Pubky Ring",
    logo: { src: "/brand/pubky-ring-logo.svg", width: 220, height: 48 },
    /** The install frame's line (45785-547431). */
    description:
      "Pubky Ring is a mobile keychain that enables you to securely authorize web services and apps.",
    appStoreUrl: "https://apps.apple.com/us/app/pubky-ring/id6739356756",
    googlePlayUrl: "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US",
  },
  {
    name: "Bitkit",
    logo: { src: "/brand/bitkit-logo.svg", width: 110, height: 32 },
    /** The install frame's line (45785-547431). */
    description:
      "Bitkit is a simple, yet powerful self-custodial wallet, that also functions as keychain for the Pubky ecosystem.",
    appStoreUrl: "https://get.bitkit.to/iOS",
    googlePlayUrl: "https://get.bitkit.to/PlayStore",
  },
] as const;

/** Bitkit's orange mark, at the size of a button's icon. */
export function BitkitIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center"
      data-slot="icon"
    >
      <svg height="14" viewBox="0 0 14 14" width="14">
        <circle cx="7" cy="7" fill="#FF4400" r="6.25" stroke="#05050A" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

/** The icon of a button that works with either keychain: both apps' marks. */
export function KeychainBrandIcon() {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1" data-slot="icon">
      <PubkyBrandIcon />
      <BitkitIcon />
    </span>
  );
}

/** Both keychains' logos in a row, each named for screen readers. */
export function KeychainLogos({
  align = "start",
  className,
}: {
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-8 gap-y-4",
        align === "center" ? "justify-center" : "justify-start",
        className,
      )}
    >
      {KEYCHAIN_APPS.map(({ name, logo }) => (
        <Image
          alt={name}
          className="h-8 w-auto md:h-10"
          height={logo.height}
          key={name}
          src={logo.src}
          width={logo.width}
        />
      ))}
    </div>
  );
}

/**
 * Each keychain as the design's install frame shows it (45785-547431): its logo, its own line and
 * where to get it, side by side from md, in the one card that offers both (decision 2).
 */
export function KeychainApps() {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-8">
      {KEYCHAIN_APPS.map((app) => (
        <div className="flex min-w-0 flex-col items-start gap-4" key={app.name}>
          <Image
            alt={app.name}
            className="h-8 w-auto md:h-10"
            height={app.logo.height}
            src={app.logo.src}
            width={app.logo.width}
          />
          <p className="text-base leading-6 text-muted-foreground">{app.description}</p>
          <StoreBadges app={app} />
        </div>
      ))}
    </div>
  );
}

/**
 * Where to get each keychain: its name and its App Store and Google Play badges. Every badge link
 * is at least 44px tall, so a thumb hits it even where the badge art is smaller.
 */
export function KeychainStoreBadges({ align = "start" }: { align?: "center" | "start" }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-8",
        align === "center" ? "items-center sm:justify-center" : "items-start",
      )}
    >
      {KEYCHAIN_APPS.map((app) => (
        <div className="flex flex-col gap-1" key={app.name}>
          <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            {app.name}
          </p>
          <StoreBadges app={app} />
        </div>
      ))}
    </div>
  );
}

/** One keychain's App Store and Google Play badges, each link named for that app. */
function StoreBadges({ app }: { app: (typeof KEYCHAIN_APPS)[number] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        aria-label={`Download ${app.name} on the App Store`}
        className="flex min-h-11 items-center rounded-md"
        href={app.appStoreUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt="Download on the App Store"
          className="h-8 w-24 md:h-10 md:w-[120px]"
          height={40}
          src="/brand/app-store-badge.svg"
          width={120}
        />
      </a>
      <a
        aria-label={`Get ${app.name} on Google Play`}
        className="flex min-h-11 items-center rounded-md"
        href={app.googlePlayUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt="Get it on Google Play"
          className="h-8 w-[108px] md:h-10 md:w-[135px]"
          height={40}
          src="/brand/google-play-badge.svg"
          width={135}
        />
      </a>
    </div>
  );
}
