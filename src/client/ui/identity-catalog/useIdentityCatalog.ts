"use client";

import { Result } from "better-result";
import { useEffect, useState } from "react";

import {
  LocalIdentityController,
} from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";

type IdentityCatalogState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
    status: "ready";
    catalog: LocalIdentityCatalog;
    controller: LocalIdentityController;
    reloadIdentities: () => void;
  };

function useIdentityCatalog(): IdentityCatalogState {
  const [session, setSession] = useState<IdentityCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setSession({ status: "loading" });
      try {
        const instance = new LocalIdentityController();
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
  }, []);

  return session;
}

export { useIdentityCatalog, type IdentityCatalogState };
