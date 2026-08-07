import { TrashIcon } from "../shared/icons/actionIcons";
import { BackButton } from "../shared/navigation/backButton";
import { Button } from "../shared/primitives/button";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";
import { GoogleDetachmentIllustration } from "./googleDetachmentIllustration";

function ReviewGoogleDetachment({ onBack, onRemove }: { onBack: () => void; onRemove: () => void }) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <DisplayHeading accent="from Google." aria-label="Detach from Google.">Detach</DisplayHeading>
      <LeadText>You are about to remove Google as a way to access your pubky identity.</LeadText>

      <div className="rounded-md bg-destructive-surface px-4 py-3 text-sm font-medium leading-5 text-destructive-foreground">
        Warning: Make sure you can sign in with your keychain or encrypted key before removing Google access. This can’t be undone.
      </div>

      <GoogleDetachmentIllustration />

      <div className="mt-auto flex flex-col gap-4">
        <BackButton onClick={onBack} />
        <Button className="w-full" onClick={onRemove} size="lg" type="button" variant="destructive">
          <TrashIcon />
          Remove Google Access
        </Button>
      </div>
    </main>
  );
}

export { ReviewGoogleDetachment };
