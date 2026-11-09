import Image from "next/image";
import { type ReactNode, useRef } from "react";

import { HowPassportWorks } from "./howPassportWorks";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

function SignInPage({ children }: { children: ReactNode }) {
  const choices = useRef<HTMLDivElement>(null);
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <section className="flex flex-col gap-6 md:gap-8">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading accent="access." aria-label="Quick access." className="[&>span]:inline">
            Quick
          </DisplayHeading>
          <HowPassportWorks onContinue={() => choices.current?.focus()}>
            Use your existing accounts to sign in to the Pubky ecosystem. No seed phrase, no app, no
            hassle.
          </HowPassportWorks>
        </div>
        <div className="flex flex-col gap-6 md:gap-8">
          <div
            aria-label="Available sign-in accounts"
            className="flex flex-col gap-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            ref={choices}
            role="group"
            tabIndex={-1}
          >
            {children}
          </div>
          <Image
            alt=""
            aria-hidden="true"
            className="mx-auto size-50"
            height={200}
            priority
            src="/illustrations/cloud.png"
            width={200}
          />
        </div>
      </section>
    </PassportScreen>
  );
}

export { SignInPage };
