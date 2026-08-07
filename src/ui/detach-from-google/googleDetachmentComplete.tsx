import Image from "next/image";

import { CheckIcon } from "../shared/icons/actionIcons";
import { Button } from "../shared/primitives/button";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

function GoogleDetachmentComplete({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-8 px-6 pb-6 pt-3">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="from Google." aria-label="Detached from Google.">Detached</DisplayHeading>
        <LeadText>Google access has been removed. Your identity is self-managed, and recoverable only with your backup.</LeadText>
        <div className="flex justify-center py-12">
          <Image alt="" aria-hidden="true" className="size-[200px]" height={200} src="/illustrations/passport-setup-complete.png" width={200} />
        </div>
      </div>

      <Button className="mt-auto w-full" onClick={onDone} size="lg" type="button">
        <CheckIcon />
        Done
      </Button>
    </main>
  );
}

export { GoogleDetachmentComplete };
