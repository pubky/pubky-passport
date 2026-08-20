import Image from "next/image";

import { TrashIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";

function ReviewGoogleDetachment({ onBack, onRemove }: { onBack: () => void; onRemove: () => void }) {
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="from Google." aria-label="Detach from Google.">Detach</DisplayHeading>
      <LeadText>You are about to remove Google as a way to access your pubky identity.</LeadText>

      <div className="rounded-md bg-destructive-surface px-4 py-3 text-sm font-medium leading-5 text-destructive-foreground">
        Warning: Make sure you can sign in with your keychain or encrypted key before removing Google access. This can’t be undone.
      </div>

      <Image
        alt=""
        className="w-full"
        data-slot="google-detachment-illustration"
        height={248}
        src="/illustrations/detach-from-google.png"
        unoptimized
        width={327}
      />

      <div className="mt-auto flex flex-col gap-4">
        <BackButton onClick={onBack} />
        <Button className="w-full" onClick={onRemove} size="lg" type="button" variant="destructive">
          <TrashIcon />
          Remove Google Access
        </Button>
      </div>
    </PassportScreen>
  );
}

export { ReviewGoogleDetachment };
