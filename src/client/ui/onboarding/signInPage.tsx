import Image from "next/image";
import type { ReactNode } from "react";

import { BrandEndorsement } from "../shared/brand/brandEndorsement";
import { PassportScreen } from "../shared/passportScreen";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

function SignInPage({ children }: { children: ReactNode }) {
  return (
    <PassportScreen className="gap-6">
      <section className="flex flex-col gap-6">
        <DisplayHeading accent="signing." aria-label="Quick & easy signing.">Quick &amp; easy</DisplayHeading>
        <LeadText>Pubky Passport is a browser-based signer for the Pubky ecosystem. No seed phrase, no app, no hassle.</LeadText>
        <Image alt="" aria-hidden="true" className="mx-auto size-[200px]" data-slot="sign-in-illustration" height={200} priority src="/illustrations/cloud.png" unoptimized width={200} />
        <div className="flex flex-col gap-3">
          {children}
        </div>
      </section>
      <footer className="mt-auto flex flex-col gap-4 text-sm font-medium leading-5 text-muted-foreground/80">
        <p>Pubky Passport is powered by <span className="text-brand">Pubky Core</span> and was built by Synonym Software, S.A. DE C.V. ©2025.</p>
        <BrandEndorsement />
      </footer>
    </PassportScreen>
  );
}

export { SignInPage };
