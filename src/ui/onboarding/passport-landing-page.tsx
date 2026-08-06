import Image from "next/image";
import type { ReactNode } from "react";

import { BrandEndorsement } from "../components/brand-endorsement";
import { SocialLoginButton } from "../components/social-login-button";
import { DisplayHeading, LeadText } from "../components/typography";

function PassportLandingPage({ googleSignInControl }: { googleSignInControl?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <section className="flex flex-col gap-6">
        <DisplayHeading accent="signing." aria-label="Quick & easy signing.">Quick &amp; easy</DisplayHeading>
        <LeadText>Pubky Passport is a browser-based signer for the Pubky ecosystem. No seed phrase, no app, no hassle.</LeadText>
        <Image alt="" aria-hidden="true" className="mx-auto size-[200px]" height={200} priority src="/illustrations/passport-signing.png" width={200} />
        <div className="flex flex-col gap-3">
          {googleSignInControl ?? <SocialLoginButton provider="google">Continue with Google</SocialLoginButton>}
          <SocialLoginButton disabled provider="apple">Continue with Apple</SocialLoginButton>
        </div>
      </section>
      <footer className="mt-auto flex flex-col gap-4 text-sm font-medium leading-5 text-muted-foreground/80">
        <p>Pubky Passport is powered by <span className="text-brand">Pubky Core</span> and was built by Synonym Software, S.A. DE C.V. ©2025.</p>
        <BrandEndorsement />
      </footer>
    </main>
  );
}

export { PassportLandingPage };
