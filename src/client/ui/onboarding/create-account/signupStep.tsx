import type { ReactNode } from "react";

import { MobilePassportFooter } from "@/client/ui/shared/mobilePassportFooter";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

export function SignupStep({
  title,
  accent,
  description,
  children,
}: {
  title: string;
  accent: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent={accent} aria-label={`${title} ${accent}`}>
          {title}
        </DisplayHeading>
        <LeadText>{description}</LeadText>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      <MobilePassportFooter />
    </PassportScreen>
  );
}
