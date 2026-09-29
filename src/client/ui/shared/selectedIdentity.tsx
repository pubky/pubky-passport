import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { shortPublicKey } from "./formatPublicKey";
import { GoogleAccountTag } from "./googleAccountTag";
import { SquareUserRoundIcon } from "./icons";
import { IdentitySummary } from "./identitySummary";
import { Button } from "./primitives/button";
import { RingKeyTag } from "./ringKeyTag";

export function SelectedIdentity({
  identity,
  onSwitch,
  disabled = false,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onSwitch: () => void;
  disabled?: boolean;
}) {
  const account = identity?.googleAccount;
  return (
    <section
      aria-label="Selected identity"
      className="@container flex min-w-0 flex-wrap items-center gap-3 rounded-2xl bg-card p-4"
    >
      {/* The basis keeps the name, key and account readable: below it the button wraps. */}
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
        {identity ? (
          <IdentitySummary
            attachment={
              identity.keySource === "ring" ? (
                <RingKeyTag />
              ) : account ? (
                <GoogleAccountTag account={account} />
              ) : undefined
            }
            avatarSrc={identity.avatarUrl ?? undefined}
            detail={shortPublicKey(identity.publicIdentity.publicKeyZ32)}
            detailClassName="uppercase"
            name={identity.profile?.name ?? "Your Pubky"}
          />
        ) : (
          <span className="text-sm text-muted-foreground">No local identity available</span>
        )}
      </div>
      <Button
        className="@max-[21rem]:w-full"
        disabled={disabled}
        onClick={onSwitch}
        size="sm"
        variant="secondary"
      >
        <SquareUserRoundIcon />
        Switch <span className="sr-only">identity</span>
      </Button>
    </section>
  );
}
