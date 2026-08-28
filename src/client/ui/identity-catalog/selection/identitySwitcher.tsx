import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import { UserRoundPlusIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { PassportNavigation } from "../../shared/passportNavigation";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { DisplayHeading } from "../../shared/primitives/typography";
import { IdentityRow } from "./identityRow";

function IdentitySwitcher({
  activePublicKeyZ32,
  identities,
  onAddIdentity,
  onBack,
  onSelect,
  selectionFailed = false,
}: {
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
  onAddIdentity: () => void;
  onBack: () => void;
  onSelect: (publicKeyZ32: string) => void;
  selectionFailed?: boolean;
}) {
  return (
    <PassportScreen className="gap-8">
      <DisplayHeading accent="identity." aria-label="Switch identity.">
        Switch
      </DisplayHeading>
      <section className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          Select a Pubky
        </p>
        {identities.map((identity) => {
          const account = identity.googleAccount;
          const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
          return (
            <IdentityRow
              {...(account?.pictureUrl ? { avatarSrc: account.pictureUrl } : {})}
              detail={account?.email ?? shortPublicKey(publicKeyZ32)}
              key={publicKeyZ32}
              name={account?.name ?? "Your Pubky"}
              onClick={() => onSelect(publicKeyZ32)}
              {...(account ? { provider: "google" } : {})}
              selected={publicKeyZ32 === activePublicKeyZ32}
            />
          );
        })}
        <Button className="mt-0 w-full" onClick={onAddIdentity} size="lg" variant="secondary">
          <UserRoundPlusIcon />
          Add identity
        </Button>
        {selectionFailed ? (
          <FieldMessage error>Could not switch identities. Please try again.</FieldMessage>
        ) : null}
      </section>
      <PassportNavigation back={<BackButton onClick={onBack} />} />
    </PassportScreen>
  );
}

function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export { IdentitySwitcher };
