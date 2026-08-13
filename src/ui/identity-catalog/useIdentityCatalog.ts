"use client";

import { Result } from "better-result";
import { useEffect, useState } from "react";

import {
  PassportIdentityController,
  type LocalIdentityCatalog,
} from "../../browser/identity/passportIdentityController";

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      catalog: LocalIdentityCatalog;
      controller: PassportIdentityController;
    };

function useIdentityCatalog(googleClientId: string, homegateBaseUrl: string): IdentityCatalogState {
  const [session, setSession] = useState<IdentityCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    queueMicrotask(() => {
      if (cancelled) return;
      setSession({ status: "loading" });
      try {
        const instance = new PassportIdentityController(googleClientId, homegateBaseUrl);
        const publish = () => {
          const catalog = instance.listIdentities();
          if (cancelled) return;
          setSession(Result.isOk(catalog)
            ? { status: "ready", catalog: catalog.value, controller: instance }
            : { status: "unavailable" });
        };
        unsubscribe = instance.subscribeToIdentityChanges(publish);
        publish();
      } catch {
        if (!cancelled) setSession({ status: "unavailable" });
      }
    });

    return () => {
      cancelled = true;
      try { unsubscribe(); } catch { /* Controller owns cleanup logging. */ }
    };
  }, [googleClientId, homegateBaseUrl]);

  return session;
}

export { useIdentityCatalog, type IdentityCatalogState };
