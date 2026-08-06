"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { createPassportIdentityController } from "../../browser/identity/passportIdentity";
import { Spinner } from "../components/spinner";
import { GoogleOnboardingFlow, type OnboardingCompletion } from "../onboarding/google-onboarding-flow";
import { SetupComplete } from "../onboarding/setup-complete";

type RootState = "checking" | "signed-out" | "signed-in" | "unavailable";

function PassportApp({ googleClientId, homegateBaseUrl }: { googleClientId: string; homegateBaseUrl: string }) {
  const controller = useRef<PassportIdentityController | null>(null);
  const setupActive = useRef(false);
  const [identityController, setIdentityController] = useState<PassportIdentityController | null>(null);
  const [state, setState] = useState<RootState>("checking");
  const [completion, setCompletion] = useState<OnboardingCompletion | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    queueMicrotask(() => {
      if (cancelled) return;
      try {
        controller.current = createPassportIdentityController(googleClientId, homegateBaseUrl);
        setIdentityController(controller.current);
        const refresh = () => {
          const catalog = controller.current?.list();
          if (!catalog || Result.isError(catalog)) setState("unavailable");
          else if (catalog.value.identities.length === 0) setState("signed-out");
          else if (!setupActive.current) setState("signed-in");
        };
        unsubscribe = controller.current.subscribe(refresh);
        refresh();
      } catch {
        setState("unavailable");
      }
    });

    return () => {
      cancelled = true;
      try { unsubscribe(); } catch { /* Controller owns cleanup logging. */ }
      try { controller.current?.dispose(); } catch { /* Controller owns cleanup logging. */ }
      controller.current = null;
    };
  }, [googleClientId, homegateBaseUrl]);

  if (completion) return <SetupComplete {...(completion.googleAccount ? { googleAccount: completion.googleAccount } : {})} identity={completion.identity} mode={completion.mode} onContinue={() => { setCompletion(null); setState("signed-in"); }} />;
  if (state === "signed-out" && identityController) {
    return <GoogleOnboardingFlow controller={identityController} onComplete={setCompletion} onSetupStarted={() => { setupActive.current = true; }} />;
  }
  if (state === "signed-in") return <main className="min-h-[calc(100svh-84px)]" data-root-state="signed-in"><span className="sr-only">Identity home</span></main>;
  if (state === "unavailable") return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;

  return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

export { PassportApp };
