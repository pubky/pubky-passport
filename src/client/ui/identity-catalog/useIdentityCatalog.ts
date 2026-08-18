"use client";

import { Result } from "better-result";
import { useEffect, useState } from "react";

import {
  PassportIdentityController,
  type LocalIdentityCatalog,
} from "../../logic/identity/PassportIdentityController";

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
    status: "ready";
    catalog: LocalIdentityCatalog;
    controller: PassportIdentityController;
    reloadIdentities: () => void;
  };

function useIdentityCatalog(googleClientId: string, homegateBaseUrl: string): IdentityCatalogState {
  const [session, setSession] = useState<IdentityCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setSession({ status: "loading" });
      try {
        const instance = new PassportIdentityController(googleClientId, homegateBaseUrl);
        const publish = () => {
          const catalog = instance.listIdentities();
          if (cancelled) return;
          setSession(Result.isOk(catalog)
            ? {
              status: "ready",
              catalog: catalog.value,
              controller: instance,
              reloadIdentities: publish,
            }
            : { status: "unavailable" });
        };
        publish();
      } catch {
        if (!cancelled) setSession({ status: "unavailable" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [googleClientId, homegateBaseUrl]);

  return session;
}

export { useIdentityCatalog, type IdentityCatalogState };
