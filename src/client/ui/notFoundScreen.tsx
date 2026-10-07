"use client";

import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ButtonLink } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/**
 * Any address Passport does not serve. Apps open Passport with links, so a stale or mistyped one
 * must still look like Passport, say what happened and lead back, not show a bare error page.
 */
export function NotFoundScreen() {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <DisplayHeading accent="not found." aria-label="Page not found.">
          Page
        </DisplayHeading>
        <LeadText>
          This link doesn’t lead anywhere in Passport. If an app sent you here, go back to the app
          and start signing in again.
        </LeadText>
      </div>
      <ButtonLink className="w-full md:w-fit" href="/" size="lg">
        <ArrowRightIcon />
        Go to Passport
      </ButtonLink>
    </PassportScreen>
  );
}
