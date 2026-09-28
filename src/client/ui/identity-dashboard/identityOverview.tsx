import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { GoogleAccountTag } from "@/client/ui/shared/googleAccountTag";
import { KeyRoundIcon, SettingsIcon, SquareUserRoundIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

function IdentityOverview({
  identity,
  onAuthorize,
  onManage,
  onSwitch,
}: {
  identity: LocalIdentityMetadata;
  onAuthorize: () => void;
  onManage: () => void;
  onSwitch: () => void;
}) {
  const account = identity.googleAccount;
  // The main card is the Pubky profile; Google only appears as the attached-account tag.
  const name = identity.profile?.name ?? "Your Pubky";
  const publicKey = identity.publicIdentity.publicKeyZ32;

  return (
    <PassportScreen className="max-w-[375px] gap-6 md:max-w-[588px] md:gap-8">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">
        Your{" "}
      </DisplayHeading>
      <section
        aria-label="Selected identity"
        className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-2xl bg-card px-6 pb-6 pt-12 md:p-12"
      >
        <div className="col-span-2 flex w-full min-w-0 flex-col items-center gap-6 md:flex-row md:items-start">
          <Avatar fallback={name} size="lg" src={identity.avatarUrl ?? undefined} />
          <div className="flex w-full min-w-0 flex-col items-center gap-3 text-center md:max-w-69 md:flex-1 md:items-start md:gap-0 md:text-left">
            <h2 className="w-full text-2xl font-bold leading-8 [overflow-wrap:anywhere]">{name}</h2>
            <p className="w-full break-all text-xs font-medium leading-4 tracking-[0.1em] text-muted-foreground md:text-left">
              {publicKey}
            </p>
            {account ? (
              <div className="flex w-full min-w-0 justify-center pt-3 md:justify-start">
                <GoogleAccountTag account={account} />
              </div>
            ) : null}
            {identity.keySource === "ring" ? (
              <p className="pt-2 text-sm text-muted-foreground">Key in Pubky Ring</p>
            ) : null}
          </div>
        </div>
        {identity.profileSetupRequired ? (
          <p className="col-span-2 text-sm leading-5 text-secondary-foreground" role="status">
            Your public profile isn&apos;t set up yet. Finish it under Manage, then Edit profile.
          </p>
        ) : null}
        <Button
          aria-label="Authorize an app"
          className="col-span-2 w-full"
          onClick={onAuthorize}
          size="lg"
          variant="secondary"
        >
          <KeyRoundIcon /> Authorize
        </Button>
        <Button
          aria-label="Manage identity"
          className="w-full"
          onClick={onManage}
          variant="secondary"
        >
          <SettingsIcon />
          Manage
        </Button>
        <Button
          aria-label="Switch identity"
          className="w-full"
          onClick={onSwitch}
          variant="secondary"
        >
          <SquareUserRoundIcon />
          Switch
        </Button>
      </section>
    </PassportScreen>
  );
}

export { IdentityOverview };
