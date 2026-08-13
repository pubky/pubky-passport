"use client";

import type {
  GoogleBackedIdentityProgress,
  PassportIdentityControllerError,
} from "../../../browser/identity/passportIdentityController";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";

type GoogleSignInView =
  | { name: "idle" }
  | { name: "requesting-access" }
  | { name: "denied" }
  | { name: "failed"; error: PassportIdentityControllerError }
  | { name: "working"; progress: GoogleBackedIdentityProgress }
  | {
      name: "complete";
      googleAccount?: GoogleAccountProfile;
      identity: PubkyPublicIdentity;
      mode: "created" | "restored";
    };

type GoogleSignInState = {
  authorizationReady: boolean;
  view: GoogleSignInView;
};

type GoogleSignInEvent =
  | { type: "authorization-ready" }
  | { type: "authorization-denied" }
  | { type: "request-started" }
  | { type: "progress-reported"; progress: GoogleBackedIdentityProgress }
  | { type: "operation-failed"; error: PassportIdentityControllerError }
  | {
      type: "operation-completed";
      googleAccount?: GoogleAccountProfile;
      identity: PubkyPublicIdentity;
      mode: "created" | "restored";
    }
  | { type: "back" };

const INITIAL_GOOGLE_SIGN_IN_STATE: GoogleSignInState = {
  authorizationReady: false,
  view: { name: "idle" },
};

function transitionGoogleSignIn(
  state: GoogleSignInState,
  event: GoogleSignInEvent,
): GoogleSignInState {
  switch (event.type) {
    case "authorization-ready":
      return {
        authorizationReady: true,
        view: state.view.name === "idle" || state.view.name === "denied"
          ? { name: "idle" }
          : state.view,
      };
    case "authorization-denied":
      return { ...state, view: { name: "denied" } };
    case "request-started":
      return { ...state, view: { name: "requesting-access" } };
    case "progress-reported":
      return { ...state, view: { name: "working", progress: event.progress } };
    case "operation-failed":
      return { ...state, view: { name: "failed", error: event.error } };
    case "operation-completed":
      return {
        ...state,
        view: {
          name: "complete",
          identity: event.identity,
          mode: event.mode,
          ...(event.googleAccount ? { googleAccount: event.googleAccount } : {}),
        },
      };
    case "back":
      return { ...state, view: { name: "idle" } };
  }
}

export {
  INITIAL_GOOGLE_SIGN_IN_STATE,
  transitionGoogleSignIn,
  type GoogleSignInEvent,
  type GoogleSignInState,
  type GoogleSignInView,
};
