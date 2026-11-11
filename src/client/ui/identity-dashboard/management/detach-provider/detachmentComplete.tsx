import Image from "next/image";

import { CheckIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function DetachmentComplete({
  onDone,
  providerName,
}: {
  onDone: () => void;
  /** Sign-in provider that was removed, for example "Google". */
  providerName: string;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading
          accent={`from ${providerName}.`}
          aria-label={`Detached from ${providerName}.`}
        >
          Detached
        </DisplayHeading>
        <LeadText>
          {providerName} access has been removed. Your identity is self-managed, and recoverable
          only with your backup.
        </LeadText>
      </div>
      <div className="flex h-[296px] items-center justify-center">
        <Image
          alt=""
          aria-hidden="true"
          className="size-50"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
      </div>
      <Button className="mt-auto w-full" onClick={onDone} size="lg" type="button">
        <CheckIcon />
        Done
      </Button>
    </PassportScreen>
  );
}

export { DetachmentComplete };
