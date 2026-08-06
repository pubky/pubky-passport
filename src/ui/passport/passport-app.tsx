"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { PassportIdentityController, PassportIdentityList } from "../../browser/identity/passportIdentity";
import { createPassportIdentityController } from "../../browser/identity/passportIdentity";
import { Spinner } from "../components/spinner";
import { GoogleOnboardingFlow, type OnboardingCompletion } from "../onboarding/google-onboarding-flow";
import { SetupComplete } from "../onboarding/setup-complete";
import { IdentityHome } from "../identity/identity-home";
import { IdentityManagement } from "../identity/identity-management";
import { IdentitySwitcher } from "../identity/identity-switcher";

type RootState = "checking" | "signed-out" | "signed-in" | "switching" | "managing" | "unavailable";

function PassportApp({ googleClientId, homegateBaseUrl }: { googleClientId: string; homegateBaseUrl: string }) {
  const controller = useRef<PassportIdentityController | null>(null);
  const setupActive = useRef(false);
  const [identityController, setIdentityController] = useState<PassportIdentityController | null>(null);
  const [state, setState] = useState<RootState>("checking");
  const [completion, setCompletion] = useState<OnboardingCompletion | null>(null);
  const [catalog, setCatalog] = useState<PassportIdentityList>({ activeIdentityId: null, identities: [] });

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
          else {
            setCatalog(catalog.value);
            if (catalog.value.identities.length === 0) setState("signed-out");
            else if (!setupActive.current) setState("signed-in");
          }
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

  if (completion) return <SetupComplete {...(completion.googleAccount ? { googleAccount: completion.googleAccount } : {})} identity={completion.identity} mode={completion.mode} onContinue={() => { setupActive.current = false; setCompletion(null); setState("signed-in"); }} />;
  if (state === "signed-out" && identityController) {
    return <GoogleOnboardingFlow controller={identityController} onComplete={setCompletion} onSetupStarted={() => { setupActive.current = true; }} />;
  }
  if (state === "switching" && catalog.activeIdentityId) {
    return <IdentitySwitcher
      activeIdentityId={catalog.activeIdentityId}
      identities={catalog.identities}
      onAddIdentity={() => setState("signed-out")}
      onBack={() => setState("signed-in")}
      onSelect={(identityId) => {
        const selected = identityController?.select(identityId);
        if (selected && !Result.isError(selected)) setState("signed-in");
      }}
    />;
  }
  if (state === "managing") {
    const activeIdentity = catalog.identities.find((identity) => identity.id === catalog.activeIdentityId);
    if (activeIdentity && identityController) return <IdentityManagement identity={activeIdentity} onBack={() => setState("signed-in")} onLogOut={() => { identityController.remove(activeIdentity.id); }} resolveHomeserver={identityController.resolveHomeserver.bind(identityController)} />;
  }
  if (state === "signed-in") {
    const activeIdentity = catalog.identities.find((identity) => identity.id === catalog.activeIdentityId);
    if (activeIdentity) {
      return <IdentityHome identity={activeIdentity} onManage={() => setState("managing")} onSwitch={() => setState("switching")} />;
    }
    return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">The active identity is unavailable.</main>;
  }
  if (state === "unavailable") return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;

  return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

export { PassportApp };
