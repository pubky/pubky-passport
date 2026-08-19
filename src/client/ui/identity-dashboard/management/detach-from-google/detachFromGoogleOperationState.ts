"use client";

import type { GoogleIdentityFlowError } from "../../../../logic/google-identity/GoogleIdentityFlow";

type DetachFromGoogleOperationState =
  | { name: "ready" }
  | { name: "requesting-authorization" }
  | { name: "deleting-backup" }
  | { name: "authorization-failed" }
  | { name: "operation-failed"; error: GoogleIdentityFlowError }
  | { name: "complete" };

type DetachFromGoogleOperationEvent =
  | { type: "authorization-failed" }
  | { type: "request-started" }
  | { type: "deletion-started" }
  | { type: "operation-failed"; error: GoogleIdentityFlowError }
  | { type: "operation-completed" };

function transitionDetachFromGoogleOperation(
  _state: DetachFromGoogleOperationState,
  event: DetachFromGoogleOperationEvent,
): DetachFromGoogleOperationState {
  switch (event.type) {
    case "authorization-failed":
      return { name: "authorization-failed" };
    case "request-started":
      return { name: "requesting-authorization" };
    case "deletion-started":
      return { name: "deleting-backup" };
    case "operation-failed":
      return { name: "operation-failed", error: event.error };
    case "operation-completed":
      return { name: "complete" };
  }
}

export {
  transitionDetachFromGoogleOperation,
  type DetachFromGoogleOperationEvent,
  type DetachFromGoogleOperationState,
};
