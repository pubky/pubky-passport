import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { useId } from "react";
import { UserRoundPlusIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Notice } from "@/client/ui/shared/notice";
import { DisplayHeading, TEXT_MEASURE } from "@/client/ui/shared/primitives/typography";
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
  const listHeadingId = useId();
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
    <PassportScreen className="gap-6 md:gap-8">
      <DisplayHeading accent="identity." aria-label="Switch identity.">
        Switch
      </DisplayHeading>
      <section className="flex min-h-0 flex-col gap-3">
        <h2
          className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground"
          id={listHeadingId}
        >
          Saved identities
        </h2>
        {/* A list, so screen readers say how many identities there are; the active one is marked
            as current. Tailwind's preflight removes list markers, and WebKit then drops the list
            semantics unless the role is explicit. From lg the rows fill two columns of the track,
            so none runs its whole width. */}
        <ul
          aria-labelledby={listHeadingId}
          className="flex flex-col gap-3 lg:grid lg:grid-cols-2"
          role="list"
        >
          {orderedIdentities.map((identity) => {
            const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
            return (
              <li key={publicKeyZ32}>
                <IdentityRow
                  className="h-full"
                  identity={identity}
                  onClick={() => onSelect(publicKeyZ32)}
                  selected={publicKeyZ32 === activePublicKeyZ32}
                />
              </li>
            );
          })}
        </ul>
        {selectionFailed ? (
          <Notice className={TEXT_MEASURE} tone="error">
            Couldn&apos;t switch. Your browser didn&apos;t let Passport save your choice. Try again.
          </Notice>
        ) : null}
      </section>
      <PassportNavigation
        back={<BackButton onClick={onBack} />}
        className="mt-auto md:mt-0"
        confirm={
          <Button className="w-full" onClick={onAddIdentity} size="lg" variant="secondary">
            <UserRoundPlusIcon />
            Add identity
          </Button>
        }
      />
    </PassportScreen>
  );
}

export { IdentitySwitcher };
