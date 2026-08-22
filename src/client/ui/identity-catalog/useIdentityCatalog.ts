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
    localIdentityController: LocalIdentityController;
    refreshIdentityCatalog: () => void;
  };

function useIdentityCatalog(): IdentityCatalogState {
  const [identityCatalogState, setIdentityCatalogState] = useState<IdentityCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setIdentityCatalogState({ status: "loading" });
      try {
        const localIdentityController = new LocalIdentityController();
        const refreshIdentityCatalog = () => {
          const catalog = localIdentityController.listIdentities();
          if (cancelled) return;
          setIdentityCatalogState(Result.isOk(catalog)
            ? {
              status: "ready",
              catalog: catalog.value,
              localIdentityController,
              refreshIdentityCatalog,
            }
            : { status: "unavailable" });
        };
        refreshIdentityCatalog();
      } catch {
        if (!cancelled) setIdentityCatalogState({ status: "unavailable" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return identityCatalogState;
}

export { useIdentityCatalog, type IdentityCatalogState };
