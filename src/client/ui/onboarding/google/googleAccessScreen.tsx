import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function GoogleAccessScreen({ purpose = "setup" }: { purpose?: "setup" | "attach" }) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="access.">Requesting Google</DisplayHeading>
        <LeadText>
          {purpose === "attach"
            ? "Complete the Google request to back up this pubky in your Google Drive."
            : "Complete the Google request to securely create or restore your pubky."}
        </LeadText>
      </div>
      <div aria-live="polite" role="status">
        <Button className="w-full" disabled size="lg" type="button" variant="secondary">
          <Spinner
            aria-hidden="true"
            className="size-4 motion-reduce:animate-none"
            role="presentation"
          />
          Waiting for Google...
        </Button>
      </div>
    </PassportScreen>
  );
}

export { GoogleAccessScreen };
