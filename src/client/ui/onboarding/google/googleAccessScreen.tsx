import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { Spinner } from "../../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { SignInContext } from "../../shared/signInContext";

function GoogleAccessScreen({ signInTo }: { signInTo?: string }) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="access." aria-label="Requesting Google access.">
          Requesting Google
        </DisplayHeading>
        {signInTo ? <SignInContext requester={signInTo} /> : null}
        <LeadText>Complete the Google request to securely create or restore your Pubky.</LeadText>
        <div aria-live="polite" role="status">
          <Button className="w-full md:w-auto" disabled size="lg" type="button" variant="secondary">
            <Spinner
              aria-hidden="true"
              className="size-4 motion-reduce:animate-none"
              role="presentation"
            />
            Waiting for Google...
          </Button>
        </div>
      </div>
    </PassportScreen>
  );
}

export { GoogleAccessScreen };
