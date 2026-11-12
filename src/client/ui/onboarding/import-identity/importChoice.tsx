import type { ReactNode } from "react";

import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon, FolderIcon, KeyRoundIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Picks how to bring in an existing pubky: its recovery phrase or its recovery file. */
function ImportChoice({
  onBack,
  onRecoveryFile,
  onRecoveryPhrase,
}: {
  onBack: () => void;
  onRecoveryFile: () => void;
  onRecoveryPhrase: () => void;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="pubky." aria-label="Import pubky.">
          Import
        </DisplayHeading>
        <LeadText>
          Use the recovery phrase or recovery file of a pubky you already have to sign in.
        </LeadText>
      </div>
      <div aria-label="Import with" className="flex flex-col gap-3" role="group">
        <ImportOption
          detail="Your 12 words"
          icon={<KeyRoundIcon size={20} />}
          onClick={onRecoveryPhrase}
        >
          Recovery phrase
        </ImportOption>
        <ImportOption
          detail="Your .pkarr file and its password"
          icon={<FolderIcon size={20} />}
          onClick={onRecoveryFile}
        >
          Recovery file
        </ImportOption>
      </div>
      <PassportNavigation back={<BackButton onClick={onBack} />} className="mt-auto pt-8" />
    </PassportScreen>
  );
}

function ImportOption({
  children,
  detail,
  icon,
  onClick,
}: {
  children: string;
  detail: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex min-h-18 w-full cursor-pointer items-center gap-3 rounded-2xl border border-transparent bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block leading-6">{children}</strong>
        <span className="block text-xs font-medium leading-4 text-muted-foreground">{detail}</span>
      </span>
      <ArrowRightIcon className="text-muted-foreground" />
    </button>
  );
}

export { ImportChoice };
