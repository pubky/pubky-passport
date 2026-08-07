import { Button } from "../shared/primitives/button";
import { Spinner } from "../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

type GoogleAccessScreenProps =
  | { status: "pending"; onBack?: never; onTryAgain?: never }
  | { status: "denied"; onBack: () => void; onTryAgain: () => void };

function GoogleAccessScreen(props: GoogleAccessScreenProps) {
  const denied = props.status === "denied";
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent={denied ? "denied." : "access."} aria-label={denied ? "Google access denied." : "Requesting Google access."}>{denied ? "Google access" : "Requesting Google"}</DisplayHeading>
        <LeadText>{denied ? "Passport needs Google Drive access to create or restore your Pubky." : "Complete the Google request to securely create or restore your Pubky."}</LeadText>
        {!denied ? <div className="flex items-center gap-3 py-3 text-muted-foreground" role="status"><Spinner />Waiting for Google…</div> : null}
      </div>
      {denied ? (
        <div className="mt-auto flex flex-col gap-3">
          <Button className="w-full" onClick={props.onTryAgain} size="lg">Try again</Button>
          <Button className="w-full" onClick={props.onBack} size="lg" variant="secondary">Return home</Button>
        </div>
      ) : null}
    </main>
  );
}

export { GoogleAccessScreen };
