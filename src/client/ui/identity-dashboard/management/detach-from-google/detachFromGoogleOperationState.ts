"use client";

import type { GoogleIdentityError } from "../../../../logic/google-identity/GoogleIdentityController";

type DetachFromGoogleOperationState =
  | { name: "ready" }
  | { name: "requesting-authorization" }
  | { name: "deleting-backup" }
  | { name: "authorization-failed" }
  | { name: "operation-failed"; error: GoogleIdentityError }
  | { name: "complete" };

type DetachFromGoogleOperationEvent =
  | { type: "authorization-failed" }
  | { type: "request-started" }
  | { type: "deletion-started" }
  | { type: "operation-failed"; error: GoogleIdentityError }
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
