import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import { LOGGER } from "../../../../libs/logger/logger";
import {
  createGoogleIdentitySession,
  type GoogleIdentityProgress,
  type GoogleIdentitySession,
  type GoogleIdentityViewError,
} from "../../../logic/google-identity/GoogleIdentityController";
import { toGoogleIdentityViewError } from "../../../logic/google-identity/googleIdentityViewError";
import type { GoogleAccountProfile } from "../../../logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityConfiguration } from "../../googleIdentityConfiguration";

type GoogleIdentityEstablishmentView =
  | { status: "idle" }
  | { status: "requesting-access" }
  | { status: "failed"; error: GoogleIdentityViewError }
  | { status: "working"; progress: GoogleIdentityProgress }
  | {
    status: "complete";
    googleAccount: GoogleAccountProfile;
    identity: PubkyPublicIdentity;
    mode: "created" | "restored";
    visibleRecoveryCopyStatus: "created" | "unconfirmed" | null;
  };

function useGoogleIdentityEstablishment() {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const controllerRef = useRef<GoogleIdentitySession | null>(null);
  const operationPendingRef = useRef(false);
  const operationIdRef = useRef(0);
  const [view, setView] = useState<GoogleIdentityEstablishmentView>({ status: "idle" });

  const ensureController = useCallback((): GoogleIdentitySession | null => {
    if (controllerRef.current) return controllerRef.current;

    try {
      const controller = createGoogleIdentitySession(
        googleClientId,
        homegateBaseUrl,
        (nextState) => {
          if (controllerRef.current !== controller) return;
          if (nextState.status === "requesting-authorization") {
            setView({ status: "requesting-access" });
          } else if (nextState.status === "establishing") {
            setView({ status: "working", progress: nextState.progress });
          }
        },
      );
      controllerRef.current = controller;
      return controller;
    } catch {
      setView({ status: "failed", error: { code: "operation_failed" } });
      return null;
    }
  }, [googleClientId, homegateBaseUrl]);

  const startIdentityOperation = useCallback((operation: "establish" | "replace-invalid-file") => {
    if (operationPendingRef.current) return;
    const controller = ensureController();
    if (!controller) return;

    operationPendingRef.current = true;
    const operationId = ++operationIdRef.current;
    setView({ status: "requesting-access" });
    const pending = operation === "establish"
      ? controller.establishIdentity()
      : controller.replaceInvalidPassportFile();

    void pending.then((result) => {
      if (controllerRef.current !== controller || operationIdRef.current !== operationId) return;
      if (Result.isError(result)) {
        if (result.error.code !== "cancelled") {
          setView({ status: "failed", error: toGoogleIdentityViewError(result.error) });
        }
        return;
      }

      setView({
        status: "complete",
        googleAccount: result.value.googleAccount,
        identity: result.value.publicIdentity,
        mode: result.value.establishmentMode,
        visibleRecoveryCopyStatus: result.value.establishmentMode === "created"
          ? result.value.visibleRecoveryCopyStatus
          : null,
      });
    }).catch(() => {
      LOGGER.warn("identity.google.establishment_ui.failed", {
        operation,
        stage: "operation_promise",
      });
      if (controllerRef.current === controller && operationIdRef.current === operationId) {
        setView({ status: "failed", error: { code: "operation_failed" } });
      }
    }).finally(() => {
      if (operationIdRef.current === operationId) operationPendingRef.current = false;
    });
  }, [ensureController]);

  const back = useCallback(() => {
    operationIdRef.current += 1;
    operationPendingRef.current = false;
    controllerRef.current?.clearPinnedGoogleSubject();
    setView({ status: "idle" });
  }, []);

  useEffect(() => {
    return () => {
      operationIdRef.current += 1;
      operationPendingRef.current = false;
      const controller = controllerRef.current;
      if (!controller) return;
      controllerRef.current = null;
      try {
        controller.dispose();
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "establishment_controller_dispose",
        });
      }
    };
  }, [ensureController]);

  return {
    back,
    establishIdentity: () => startIdentityOperation("establish"),
    replaceInvalidPassportFile: () => startIdentityOperation("replace-invalid-file"),
    view,
  };
}

export { useGoogleIdentityEstablishment };
