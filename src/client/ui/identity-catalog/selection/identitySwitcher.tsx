import {
  identityProfile,
  type LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { UserRoundPlusIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { IdentityRow } from "./identityRow";

function IdentitySwitcher({
  activePublicKeyZ32,
  addIdentityLabel = "Add identity",
  identities,
  onAddIdentity,
  onBack,
  onSelect,
  selectionFailed = false,
}: {
  activePublicKeyZ32: string | null;
  addIdentityLabel?: "Add identity" | "Use other identity";
  identities: readonly LocalIdentityMetadata[];
  onAddIdentity: () => void;
  onBack: () => void;
  onSelect: (publicKeyZ32: string) => void;
  selectionFailed?: boolean;
}) {
  const orderedIdentities = activePublicKeyZ32
    ? [
        ...identities.filter(
          (identity) => identity.publicIdentity.publicKeyZ32 === activePublicKeyZ32,
        ),
        ...identities.filter(
          (identity) => identity.publicIdentity.publicKeyZ32 !== activePublicKeyZ32,
        ),
      ]
    : identities;

  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="identity." aria-label="Switch identity.">
        Switch
      </DisplayHeading>
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          Select a Pubky
        </p>
        {orderedIdentities.map((identity) => {
          const profile = identityProfile(identity);
          const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
          return (
            <IdentityRow
              avatarSrc={profile.pictureUrl ?? undefined}
              detail={profile.email ?? shortPublicKey(publicKeyZ32)}
              key={publicKeyZ32}
              name={profile.name ?? "Your Pubky"}
              onClick={() => onSelect(publicKeyZ32)}
              provider={
                identity.googleAccount ? "google" : identity.appleAccount ? "apple" : undefined
              }
              selected={publicKeyZ32 === activePublicKeyZ32}
            />
          );
        })}
        {selectionFailed ? (
          <FieldMessage error>Could not switch identities. Please try again.</FieldMessage>
        ) : null}
        <div className="flex min-h-[136px] flex-1 flex-col gap-4">
          <Button className="w-full" onClick={onAddIdentity} size="lg" variant="secondary">
            <UserRoundPlusIcon />
            {addIdentityLabel}
          </Button>
          <BackButton className="mt-auto" onClick={onBack} />
        </div>
      </section>
    </PassportScreen>
  );
}

export { IdentitySwitcher };
