import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Shown when the import screens could not be loaded. */
function ImportUnavailable({ onBack }: { onBack: () => void; onComplete: () => void }) {
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="unavailable." aria-label="Import unavailable.">
        Import
      </DisplayHeading>
      <LeadText>Passport could not load this page. Check your connection, then reload.</LeadText>
      <PassportNavigation back={<BackButton onClick={onBack} />} className="mt-auto pt-8" />
    </PassportScreen>
  );
}

export { ImportUnavailable };
