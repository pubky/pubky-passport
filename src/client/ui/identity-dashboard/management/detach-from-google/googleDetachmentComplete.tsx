import { CheckIcon } from "@/client/ui/shared/icons";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
import { Button } from "@/client/ui/shared/primitives/button";

function GoogleDetachmentComplete({ onDone }: { onDone: () => void }) {
  return (
    <OutcomeScreen
      accent="from Google."
      action={
        <Button className="w-full" onClick={onDone} size="lg" type="button">
          <CheckIcon />
          Done
        </Button>
      }
      description="Your Google backup has been removed. You’re still signed in on this device. Keep your own backup safe, or back up to Google again from Manage identity."
      label="Detached from Google."
      title="Detached"
    />
  );
}

export { GoogleDetachmentComplete };
