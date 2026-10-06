import { Facehash } from "facehash";

import { cn } from "@/client/ui/shared/mergeClassNames";
import { usePrefersReducedMotion } from "@/client/ui/shared/usePrefersReducedMotion";

/**
 * pubky.app's palette for avatars without a picture (`FacehashAvatar.constants.ts`); the key picks
 * one, so it must stay the same list in the same order.
 */
export const FACEHASH_AVATAR_COLORS = [
  "#00FF5D",
  "#00F0FF",
  "#004BFF",
  "#FC00FF",
  "#FF0000",
  "#FF9900",
] as const;

/**
 * The letter the face shows as its mouth, as pubky.app picks it: the first letter of the profile
 * name, else the key's first character, upper-cased. Whole characters, so a name starting with an
 * emoji shows the emoji rather than half of it.
 */
export function facehashInitial(publicKey: string, profileName?: string): string {
  const first = (value: string) => Array.from(value)[0] ?? "";
  return first(first(profileName?.trim() ?? "").toUpperCase()) || first(publicKey).toUpperCase();
}

/**
 * The avatar pubky.app shows for a pubky without a profile picture (`FacehashAvatar`,
 * pubky/pubky-app b49c813d): a `facehash` face seeded by the bare z32 key with pubky.app's props
 * and palette, so a key gets the same face and colour in both, and the initial as its mouth. It
 * fills its box and is decorative: whatever it sits in names the identity. With reduced motion it
 * neither blinks nor turns on hover; its resting pose stays, so it still looks the same.
 */
export function FacehashAvatar({
  className,
  profileName,
  publicKey,
}: {
  className?: string | undefined;
  profileName?: string | undefined;
  publicKey: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <Facehash
      aria-hidden="true"
      className={cn("h-full w-full rounded-full text-background", className)}
      colors={[...FACEHASH_AVATAR_COLORS]}
      enableBlink={!reducedMotion}
      intensity3d="dramatic"
      interactive={!reducedMotion}
      name={publicKey}
      onRenderMouth={() => (
        <span style={{ fontSize: "26cqw", lineHeight: 1 }}>
          {facehashInitial(publicKey, profileName)}
        </span>
      )}
      showInitial={false}
      size="100%"
    />
  );
}
