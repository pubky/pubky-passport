import type { GoogleIdentityFlowError } from "../../../../logic/identity/passportIdentityController";

type DetachFromGoogleOperationState =
  | { name: "preparing" }
  | { name: "ready" }
  | { name: "requesting-authorization" }
  | { name: "deleting-backup" }
  | { name: "authorization-failed" }
  | { name: "operation-failed"; error: GoogleIdentityFlowError }
  | { name: "complete" };

type DetachFromGoogleOperationEvent =
  | { type: "authorization-ready" }
  | { type: "authorization-failed" }
  | { type: "request-started" }
  | { type: "deletion-started" }
  | { type: "operation-failed"; error: GoogleIdentityFlowError }
  | { type: "operation-completed" }
  | { type: "retry-requested" };

function transitionDetachFromGoogleOperation(
  state: DetachFromGoogleOperationState,
  event: DetachFromGoogleOperationEvent,
): DetachFromGoogleOperationState {
  switch (event.type) {
    case "authorization-ready":
      return state.name === "preparing" || state.name === "authorization-failed"
        ? { name: "ready" }
        : state;
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
    case "retry-requested":
      return state.name === "authorization-failed" ? { name: "preparing" } : state;
  }
}

export {
  transitionDetachFromGoogleOperation,
  type DetachFromGoogleOperationEvent,
  type DetachFromGoogleOperationState,
};
