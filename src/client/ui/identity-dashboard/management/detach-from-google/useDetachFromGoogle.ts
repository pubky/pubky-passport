"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import { LOGGER } from "../../../../../libs/logger/logger";
import {
  GoogleIdentityController,
  type GoogleIdentityViewError,
} from "../../../../logic/google-identity/GoogleIdentityController";
import { toGoogleIdentityViewError } from "../../../../logic/google-identity/googleIdentityViewError";
import type { PubkyPublicIdentity } from "../../../../logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityConfiguration } from "../../../googleIdentityConfiguration";

type DetachFromGoogleOperationState =
  | { status: "ready" }
  | { status: "requesting-authorization" }
  | { status: "detaching" }
  | { status: "authorization-failed" }
  | { status: "operation-failed"; error: GoogleIdentityViewError }
  | { status: "complete" };

function useDetachFromGoogle(
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleSubject: string,
) {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const controllerRef = useRef<GoogleIdentityController | null>(null);
  const operationPendingRef = useRef(false);
  const operationIdRef = useRef(0);
  const [state, setState] = useState<DetachFromGoogleOperationState>({ status: "ready" });

  const ensureController = useCallback((): GoogleIdentityController | null => {
    if (controllerRef.current) return controllerRef.current;

    try {
      const controller = new GoogleIdentityController(googleClientId, homegateBaseUrl, (nextState) => {
        if (controllerRef.current !== controller) return;
        if (nextState.status === "requesting-authorization") {
          setState({ status: "requesting-authorization" });
        } else if (nextState.status === "detaching") {
          setState({ status: "detaching" });
        }
      });
      controllerRef.current = controller;
      return controller;
    } catch {
      setState({ status: "operation-failed", error: { code: "operation_failed" } });
      return null;
    }
  }, [googleClientId, homegateBaseUrl]);

  const detach = useCallback(() => {
    if ((state.status !== "ready"
      && state.status !== "authorization-failed"
      && state.status !== "operation-failed")
      || operationPendingRef.current) return;
    if (!expectedGoogleSubject.trim()) {
      setState({ status: "operation-failed", error: { code: "operation_failed" } });
      return;
    }

    const controller = ensureController();
    if (!controller) return;
    operationPendingRef.current = true;
    const operationId = ++operationIdRef.current;
    setState({ status: "requesting-authorization" });

    void controller.detachIdentity(publicIdentity, expectedGoogleSubject).then((completed) => {
      if (controllerRef.current !== controller || operationIdRef.current !== operationId) return;
      if (Result.isError(completed)) {
        if (completed.error.code === "cancelled") return;
        setState(completed.error.code === "authorization_failed"
          ? { status: "authorization-failed" }
          : { status: "operation-failed", error: toGoogleIdentityViewError(completed.error) });
        return;
      }
      setState({ status: "complete" });
    }).catch(() => {
      LOGGER.warn("identity.google.detachment_ui.failed", {
        operation: "detach",
        stage: "operation_promise",
      });
      if (controllerRef.current === controller && operationIdRef.current === operationId) {
        setState({ status: "operation-failed", error: { code: "operation_failed" } });
      }
    }).finally(() => {
      if (operationIdRef.current === operationId) operationPendingRef.current = false;
    });
  }, [ensureController, expectedGoogleSubject, publicIdentity, state.status]);

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
          operation: "detachment_controller_dispose",
        });
      }
    };
  }, [ensureController]);

  return { detach, retryDetachment: detach, state };
}

export { useDetachFromGoogle };
