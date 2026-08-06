"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { createPassportIdentityController } from "../../browser/identity/passportIdentity";
import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import { Spinner } from "../components/spinner";
import { GoogleIdentitySetupFlow } from "./google-identity-setup-flow";
import { SetupComplete } from "./setup-complete";

type RootState = "checking" | "signed-out" | "signed-in" | "unavailable";

function RootPageFlow({ googleClientId, homegateBaseUrl }: { googleClientId: string; homegateBaseUrl: string }) {
  const controller = useRef<PassportIdentityController | null>(null);
  const setupActive = useRef(false);
  const [identityController, setIdentityController] = useState<PassportIdentityController | null>(null);
  const [state, setState] = useState<RootState>("checking");
  const [completedIdentity, setCompletedIdentity] = useState<PubkyPublicIdentity | null>(null);

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

  if (completedIdentity) return <SetupComplete identity={completedIdentity} onContinue={() => { setCompletedIdentity(null); setState("signed-in"); }} />;
  if (state === "signed-out" && identityController) {
    return <GoogleIdentitySetupFlow controller={identityController} onComplete={setCompletedIdentity} onSetupStarted={() => { setupActive.current = true; }} />;
  }
  if (state === "signed-in") return <main className="min-h-[calc(100svh-84px)]" data-root-state="signed-in"><span className="sr-only">Identity home</span></main>;
  if (state === "unavailable") return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;

  return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

export { RootPageFlow };
