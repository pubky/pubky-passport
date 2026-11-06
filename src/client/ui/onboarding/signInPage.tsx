import Image from "next/image";
import type { ReactNode } from "react";

import { PASSPORT_README_URL } from "./google/continueWithGoogle";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

const PROVIDER_LEAD = {
  google: "Use your Google account to sign in to the Pubky ecosystem.",
  apple: "Use your Apple Account to sign in to the Pubky ecosystem.",
  "google-or-apple": "Use your Google Account or Apple Account to sign in to the Pubky ecosystem.",
} as const;

function SignInPage({
  provider = "google",
  children,
}: {
  /** Which accounts the buttons below offer. */
  provider?: keyof typeof PROVIDER_LEAD;
  children: ReactNode;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <section className="flex flex-col gap-6 md:gap-8">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading
            accent="signing."
            aria-label="Quick & easy signing."
            desktopAccentOnNewLine
          >
            Quick &amp; easy
          </DisplayHeading>
          <LeadText>
            {PROVIDER_LEAD[provider]} No seed phrase, no app, no hassle.{" "}
            <a
              className="rounded-sm font-bold text-brand outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
              href={PASSPORT_README_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              How?
            </a>
          </LeadText>
        </div>
        <div className="grid gap-6 md:grid-cols-(--passport-content-columns) md:gap-0">
          <Image
            alt=""
            aria-hidden="true"
            className="mx-auto size-50 md:col-start-2 md:row-start-1 md:mt-2.5"
            height={200}
            priority
            src="/illustrations/cloud.png"
            width={200}
          />
          <div className="flex flex-col gap-3 md:col-start-1 md:row-start-1">{children}</div>
        </div>
      </section>
    </PassportScreen>
  );
}

export { SignInPage };
