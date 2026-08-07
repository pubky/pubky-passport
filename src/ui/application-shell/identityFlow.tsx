"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { LocalIdentitySummary, PassportIdentityController, PassportIdentityList } from "../../browser/identity/passportIdentity";
import { createPassportIdentityController } from "../../browser/identity/passportIdentity";
import { DetachFromGoogleFlow } from "../detach-from-google/detachFromGoogleFlow";
import { IdentityManagement } from "../identity-management/identityManagement";
import { EncryptedBackup } from "../identity-management/encryptedBackup";
import { IdentityOverview } from "../identity-overview/identityOverview";
import { IdentitySwitcher } from "../identity-switcher/identitySwitcher";
import { Spinner } from "../shared/primitives/spinner";
import { SignInFlow } from "../sign-in/signInFlow";

type RootState = "checking" | "signed-out" | "signed-in" | "switching" | "managing" | "downloading-backup" | "detaching-google" | "unavailable";

function IdentityFlow({ googleClientId, homegateBaseUrl }: { googleClientId: string; homegateBaseUrl: string }) {
  const detachmentActive = useRef(false);
  const setupActive = useRef(false);
  const [detachingIdentity, setDetachingIdentity] = useState<LocalIdentitySummary | null>(null);
  const [identityController, setIdentityController] = useState<PassportIdentityController | null>(null);
  const [state, setState] = useState<RootState>("checking");
  const [catalog, setCatalog] = useState<PassportIdentityList>({ activeIdentityId: null, identities: [] });

  useEffect(() => {
    let cancelled = false;
    let instance: PassportIdentityController | null = null;
    let unsubscribe = () => {};

    queueMicrotask(() => {
      if (cancelled) return;
      try {
        instance = createPassportIdentityController(googleClientId, homegateBaseUrl);
        setIdentityController(instance);
        const refresh = () => {
          const nextCatalog = instance?.list();
          if (!nextCatalog || Result.isError(nextCatalog)) setState("unavailable");
          else {
            setCatalog(nextCatalog.value);
            if (nextCatalog.value.identities.length === 0) {
              if (!detachmentActive.current) setState("signed-out");
            } else if (!setupActive.current && !detachmentActive.current) setState("signed-in");
          }
        };
        unsubscribe = instance.subscribe(refresh);
        refresh();
      } catch {
        setState("unavailable");
      }
    });

    return () => {
      cancelled = true;
      try { unsubscribe(); } catch { /* Controller owns cleanup logging. */ }
      try { instance?.dispose(); } catch { /* Controller owns cleanup logging. */ }
    };
  }, [googleClientId, homegateBaseUrl]);

  if (state === "signed-out" && identityController) {
    return <SignInFlow
      controller={identityController}
      onComplete={() => { setupActive.current = false; setState("signed-in"); }}
      onSetupStarted={() => { setupActive.current = true; }}
    />;
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
    if (activeIdentity && identityController) return <IdentityManagement identity={activeIdentity} onBack={() => setState("signed-in")} onDetachFromGoogle={() => { detachmentActive.current = true; setDetachingIdentity(activeIdentity); setState("detaching-google"); }} onDownloadBackup={() => setState("downloading-backup")} onLogOut={() => { identityController.remove(activeIdentity.id); }} resolveHomeserver={identityController.resolveHomeserver.bind(identityController)} />;
  }
  if (state === "downloading-backup") {
    const activeIdentity = catalog.identities.find((identity) => identity.id === catalog.activeIdentityId);
    if (activeIdentity && identityController) return <EncryptedBackup createBackup={identityController.createBackup.bind(identityController)} identityId={activeIdentity.id} onBack={() => setState("managing")} />;
  }
  if (state === "detaching-google" && detachingIdentity && identityController) {
    return <DetachFromGoogleFlow
      controller={identityController}
      identity={detachingIdentity}
      onBack={() => { detachmentActive.current = false; setDetachingIdentity(null); setState("managing"); }}
      onDone={() => {
        detachmentActive.current = false;
        setDetachingIdentity(null);
        setState(catalog.identities.length === 0 ? "signed-out" : "signed-in");
      }}
    />;
  }
  if (state === "signed-in") {
    const activeIdentity = catalog.identities.find((identity) => identity.id === catalog.activeIdentityId);
    if (activeIdentity) {
      return <IdentityOverview identity={activeIdentity} onManage={() => setState("managing")} onSwitch={() => setState("switching")} />;
    }
    return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">The active identity is unavailable.</main>;
  }
  if (state === "unavailable") return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;

  return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

export { IdentityFlow };
