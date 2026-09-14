import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { useSyncExternalStore } from "react";
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
  const desktopViewport = useSyncExternalStore(
    subscribeToDesktopViewport,
    getDesktopViewport,
    getServerDesktopViewport,
  );
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
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          Select a Pubky
        </p>
        {orderedIdentities.map((identity) => {
          const account = identity.googleAccount;
          const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
          return (
            <IdentityRow
              avatarSrc={account?.pictureUrl ?? undefined}
              detail={account?.email ?? shortPublicKey(publicKeyZ32)}
              key={publicKeyZ32}
              name={account?.name ?? "Your Pubky"}
              onClick={() => onSelect(publicKeyZ32)}
              provider={account ? "google" : undefined}
              selected={publicKeyZ32 === activePublicKeyZ32}
            />
          );
        })}
        {selectionFailed ? (
          <FieldMessage error>Could not switch identities. Please try again.</FieldMessage>
        ) : null}
        <div className="flex min-h-[136px] flex-1 flex-col gap-4 md:grid md:min-h-0 md:flex-none md:grid-cols-[120px_1fr_228px] md:items-center md:gap-0">
          {desktopViewport
            ? [
                <div className="mt-auto w-full md:col-start-1 md:mt-0" key="back">
                  <BackButton onClick={onBack} />
                </div>,
                <div className="w-full md:col-start-3" key="add">
                  <Button className="w-full" onClick={onAddIdentity} size="lg" variant="secondary">
                    <UserRoundPlusIcon />
                    {addIdentityLabel}
                  </Button>
                </div>,
              ]
            : [
                <div className="w-full" key="add">
                  <Button className="w-full" onClick={onAddIdentity} size="lg" variant="secondary">
                    <UserRoundPlusIcon />
                    {addIdentityLabel}
                  </Button>
                </div>,
                <div className="mt-auto w-full" key="back">
                  <BackButton onClick={onBack} />
                </div>,
              ]}
        </div>
      </section>
    </PassportScreen>
  );
}

const DESKTOP_VIEWPORT_QUERY = "(min-width: 48rem)";

function subscribeToDesktopViewport(onChange: () => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => undefined;
  const query = globalThis.matchMedia(DESKTOP_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getDesktopViewport(): boolean {
  return (
    typeof globalThis.matchMedia !== "function" ||
    globalThis.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  );
}

function getServerDesktopViewport(): boolean {
  return true;
}

export { IdentitySwitcher };
