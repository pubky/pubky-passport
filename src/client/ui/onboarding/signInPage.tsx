import Image from "next/image";
import type { ReactNode } from "react";

import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function SignInPage({ children }: { children: ReactNode }) {
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
            Pubky Passport is a browser-based signer for the Pubky ecosystem. No seed phrase, no
            app, no hassle.
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
