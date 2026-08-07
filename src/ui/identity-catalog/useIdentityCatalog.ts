"use client";

import { Result } from "better-result";
import { useEffect, useState } from "react";

import {
  createPassportIdentityController,
  type PassportIdentityController,
  type PassportIdentityList,
} from "../../browser/identity/passportIdentity";

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      catalog: PassportIdentityList;
      controller: PassportIdentityController;
    };

function useIdentityCatalog(googleClientId: string, homegateBaseUrl: string): IdentityCatalogState {
  const [session, setSession] = useState<IdentityCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let controller: PassportIdentityController | null = null;
    let unsubscribe = () => {};

    queueMicrotask(() => {
      if (cancelled) return;
      setSession({ status: "loading" });
      try {
        const instance = createPassportIdentityController(googleClientId, homegateBaseUrl);
        controller = instance;
        const publish = () => {
          const catalog = instance.list();
          if (cancelled) return;
          setSession(Result.isOk(catalog)
            ? { status: "ready", catalog: catalog.value, controller: instance }
            : { status: "unavailable" });
        };
        unsubscribe = instance.subscribe(publish);
        publish();
      } catch {
        if (!cancelled) setSession({ status: "unavailable" });
      }
    });

    return () => {
      cancelled = true;
      try { unsubscribe(); } catch { /* Controller owns cleanup logging. */ }
      try { controller?.dispose(); } catch { /* Controller owns cleanup logging. */ }
    };
  }, [googleClientId, homegateBaseUrl]);

  return session;
}

export { useIdentityCatalog, type IdentityCatalogState };
