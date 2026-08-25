"use client";

import { BackButton } from "../shared/backButton";
import { PassportScreen } from "../shared/passportScreen";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

function InvalidAuthorization({ onBack }: { onBack: () => void }) {
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="request." aria-label="Invalid authorization request">Invalid authorization</DisplayHeading>
      <LeadText>The authorization link is malformed, unsafe, or no longer supported.</LeadText>
      <div className="mt-auto"><BackButton onClick={onBack} /></div>
    </PassportScreen>
  );
}

export { InvalidAuthorization };
