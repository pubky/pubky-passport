import { Spinner } from "../components/spinner";
import { DisplayHeading, LeadText } from "../components/typography";

function IdentityLookup() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <DisplayHeading accent="existing Pubky." aria-label="Looking for existing Pubky.">Looking for</DisplayHeading>
      <LeadText>Checking Google Drive for an encrypted Passport backup.</LeadText>
      <div className="flex items-center gap-3 py-3 text-muted-foreground" role="status">
        <Spinner />
        Checking Google Drive…
      </div>
    </main>
  );
}

export { IdentityLookup };
