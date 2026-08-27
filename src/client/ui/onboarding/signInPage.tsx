import Image from "next/image";
import type { ReactNode } from "react";

import { BrandEndorsement } from "../shared/brand/brandEndorsement";
import { PassportScreen } from "../shared/passportScreen";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";

function SignInPage({ children }: { children: ReactNode }) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <section className="flex flex-col gap-6 md:grid md:grid-cols-[307px_281px] md:gap-x-0 md:gap-y-3">
        <DisplayHeading accent="signing." aria-label="Quick & easy signing." className="md:col-span-2">Quick &amp; easy </DisplayHeading>
        <LeadText className="md:col-span-2">Pubky Passport is a browser-based signer for the Pubky ecosystem. No seed phrase, no app, no hassle.</LeadText>
        <Image alt="" aria-hidden="true" className="mx-auto size-[200px] md:col-start-2 md:row-start-3 md:mt-[42px]" height={200} priority src="/illustrations/cloud.png" unoptimized width={200} />
        <div className="flex flex-col gap-3 md:col-start-1 md:row-start-3 md:mt-14">
          {children}
        </div>
      </section>
      <footer className="mt-auto flex flex-col gap-4 text-sm font-medium leading-5 text-muted-foreground/80 md:hidden">
        <p>Pubky Passport is powered by <span className="text-brand">Pubky Core</span> and was built by Synonym Software, S.A. DE C.V. ©2025.</p>
        <BrandEndorsement />
      </footer>
    </PassportScreen>
  );
}

export { SignInPage };
