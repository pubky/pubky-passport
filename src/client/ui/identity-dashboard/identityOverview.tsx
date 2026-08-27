import type { LocalIdentityMetadata } from "../../logic/local-identity/localIdentityModels";
import { GoogleLogo } from "../shared/brand/googleLogo";
import { KeyRoundIcon, SettingsIcon, SquareUserRoundIcon } from "../shared/actionIcons";
import { PassportScreen } from "../shared/passportScreen";
import { Avatar } from "../shared/primitives/avatar";
import { Button, ButtonLink } from "../shared/primitives/button";
import { DisplayHeading } from "../shared/primitives/typography";

function IdentityOverview({ identity, onManage, onSwitch }: {
  identity: LocalIdentityMetadata;
  onManage: () => void;
  onSwitch: () => void;
}) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";

  return (
    <PassportScreen className="gap-8">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">Your </DisplayHeading>
      <section className="flex w-full flex-col items-center gap-6 overflow-hidden rounded-2xl bg-card px-6 pb-6 pt-12 md:grid md:grid-cols-[96px_1fr] md:grid-rows-[104px_60px_40px] md:gap-x-6 md:gap-y-6 md:p-12">
        <Avatar fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
        <div className="flex w-full flex-col items-center gap-0 text-center md:items-start md:self-start md:text-left">
          <h2 className="w-[276px] max-w-full text-2xl font-bold leading-8">{name}</h2>
          <p className="w-[276px] max-w-full break-all text-xs font-medium normal-case leading-4 tracking-[0.1em] text-muted-foreground">{identity.publicIdentity.publicKeyZ32}</p>
          {account ? <p className="flex h-10 w-[276px] max-w-full items-center gap-2 py-2 text-sm font-bold leading-5 normal-case"><GoogleLogo />{account.email}</p> : null}
        </div>
        <ButtonLink className="w-full md:col-span-2" href="/authorize" size="lg" variant="secondary"><KeyRoundIcon />Authorize</ButtonLink>
        <div className="flex w-full gap-3 md:col-span-2">
          <Button className="min-w-0 flex-1" onClick={onManage} variant="secondary"><SettingsIcon />Manage</Button>
          <Button className="min-w-0 flex-1" onClick={onSwitch} variant="secondary"><SquareUserRoundIcon />Switch</Button>
        </div>
      </section>
    </PassportScreen>
  );
}

export { IdentityOverview };
