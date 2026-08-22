"use client";

import type {
  GoogleIdentityError,
} from "../../../logic/google-identity/GoogleIdentityController";
import type { GoogleIdentityProgress } from "../../../logic/google-identity/GoogleIdentityController";
import type { GoogleAccountProfile } from "../../../logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";

type GoogleIdentityEstablishmentView =
  | { status: "idle" }
  | { status: "requesting-access" }
  | { status: "denied" }
  | { status: "failed"; error: GoogleIdentityError }
  | { status: "working"; progress: GoogleIdentityProgress }
  | {
    status: "complete";
    googleAccount: GoogleAccountProfile;
    identity: PubkyPublicIdentity;
    mode: "created" | "restored";
  };

type GoogleIdentityEstablishmentState = {
  view: GoogleIdentityEstablishmentView;
};

type GoogleIdentityEstablishmentEvent =
  | { type: "authorization-denied" }
  | { type: "request-started" }
  | { type: "progress-reported"; progress: GoogleIdentityProgress }
  | { type: "operation-failed"; error: GoogleIdentityError }
  | {
    type: "operation-completed";
    googleAccount: GoogleAccountProfile;
    identity: PubkyPublicIdentity;
    mode: "created" | "restored";
  }
  | { type: "back" };

const INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE: GoogleIdentityEstablishmentState = {
  view: { status: "idle" },
};

function transitionGoogleIdentityEstablishment(
  _state: GoogleIdentityEstablishmentState,
  event: GoogleIdentityEstablishmentEvent,
): GoogleIdentityEstablishmentState {
  switch (event.type) {
    case "authorization-denied":
      return { view: { status: "denied" } };
    case "request-started":
      return { view: { status: "requesting-access" } };
    case "progress-reported":
      return { view: { status: "working", progress: event.progress } };
    case "operation-failed":
      return { view: { status: "failed", error: event.error } };
    case "operation-completed":
      return {
        view: {
          status: "complete",
          googleAccount: event.googleAccount,
          identity: event.identity,
          mode: event.mode,
        },
      };
    case "back":
      return { view: { status: "idle" } };
  }
}

export {
  INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
  transitionGoogleIdentityEstablishment,
  type GoogleIdentityEstablishmentEvent,
  type GoogleIdentityEstablishmentState,
  type GoogleIdentityEstablishmentView,
};
