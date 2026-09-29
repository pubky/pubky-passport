import type { ReactNode } from "react";

import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

export function SignupStep({
  title,
  accent,
  description,
  children,
  wide = false,
}: {
  title: string;
  accent: string;
  description: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <PassportScreen width={wide ? "wide" : "compact"} className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <DisplayHeading className="[&>span]:inline" accent={accent}>
          {title}
        </DisplayHeading>
        <LeadText>{description}</LeadText>
      </div>
      <div className="flex flex-1 flex-col gap-6 md:gap-8">{children}</div>
    </PassportScreen>
  );
}
