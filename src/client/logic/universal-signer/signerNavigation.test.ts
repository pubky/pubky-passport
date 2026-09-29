import { describe, expect, it } from "vitest";

import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  initialSignerNavigation,
  requiresProfileSetup,
  resolveSignerNavigation,
  type SignerNavigation,
} from "./signerNavigation";

const READY: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: "ready" } };
const UNFINISHED: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "unfinished" },
  profileSetupRequired: true,
};
const DRAFT = {
  publicIdentity: { publicKeyZ32: "draft" },
  invite: { homeserverPubky: "homeserver", signupToken: "invite" },
  step: "password" as const,
};

function context(
  identities: readonly LocalIdentityMetadata[],
  active: string | null = identities[0]?.publicIdentity.publicKeyZ32 ?? null,
  requestPending = false,
) {
  const catalog: LocalIdentityCatalog = { activePublicKeyZ32: active, identities };
  return { catalog, requestPending };
}

describe("an app's request", () => {
  it("opens on the identity list, also with nothing saved", () => {
    expect(initialSignerNavigation(context([READY], "ready", true), null)).toEqual({
      view: "choose",
    });
    expect(initialSignerNavigation(context([], null, true), null)).toEqual({ view: "choose" });
  });

  it("resumes a submitted account setup with Back leading to the list", () => {
    expect(
      initialSignerNavigation(context([READY], "ready", true), {
        ...DRAFT,
        registrationStarted: true,
      }),
    ).toEqual({ view: "create-account", back: "choose" });
  });

  it("reviews the active identity from home and lists identities without one", () => {
    const home: SignerNavigation = { view: "home" };
    expect(resolveSignerNavigation(home, context([READY], "ready", true))).toBe(home);
    expect(resolveSignerNavigation(home, context([READY], null, true))).toEqual({
      view: "choose",
    });
    expect(resolveSignerNavigation(home, context([], null, true))).toEqual({ view: "choose" });
  });

  it("replaces the switcher with the list and keeps the list while the request waits", () => {
    expect(resolveSignerNavigation({ view: "switch" }, context([READY], "ready", true))).toEqual({
      view: "choose",
    });
    const choose: SignerNavigation = { view: "choose" };
    expect(resolveSignerNavigation(choose, context([READY], "ready", true))).toBe(choose);
  });

  it("never forces profile setup in front of the review", () => {
    for (const identity of [UNFINISHED, { ...UNFINISHED, keySource: "ring" as const }]) {
      const pending = context([identity], "unfinished", true);
      expect(initialSignerNavigation(pending, null)).toEqual({ view: "choose" });
      const home: SignerNavigation = { view: "home" };
      expect(resolveSignerNavigation(home, pending)).toBe(home);
    }
  });

  it("leaves the list for home once no request is pending", () => {
    expect(resolveSignerNavigation({ view: "choose" }, context([READY]))).toEqual({
      view: "home",
    });
    expect(resolveSignerNavigation({ view: "choose" }, context([]))).toEqual({
      view: "add",
      back: null,
    });
  });
});

describe("initialSignerNavigation", () => {
  it("opens addition explicitly when nothing is saved", () => {
    expect(initialSignerNavigation(context([]), null)).toEqual({ view: "add", back: null });
  });

  it("starts home when identities exist", () => {
    expect(initialSignerNavigation(context([READY]), null)).toEqual({ view: "home" });
  });

  it("resumes only a submitted account setup", () => {
    expect(initialSignerNavigation(context([]), DRAFT)).toEqual({ view: "add", back: null });
    expect(initialSignerNavigation(context([]), { ...DRAFT, registrationStarted: true })).toEqual({
      view: "create-account",
      back: null,
    });
    expect(
      initialSignerNavigation(context([READY]), { ...DRAFT, registrationStarted: true }),
    ).toEqual({ view: "create-account", back: "home" });
  });

  it("does not resume a submitted setup whose identity is already saved", () => {
    const registered = {
      ...DRAFT,
      publicIdentity: READY.publicIdentity,
      registrationStarted: true,
    };
    expect(initialSignerNavigation(context([READY]), registered)).toEqual({ view: "home" });
  });

  it("resumes a submitted account setup although another identity's profile is unfinished", () => {
    const navigation = initialSignerNavigation(context([UNFINISHED]), {
      ...DRAFT,
      registrationStarted: true,
    });
    expect(resolveSignerNavigation(navigation, context([UNFINISHED]))).toEqual({
      view: "create-account",
      back: "home",
    });
  });
});

describe("resolveSignerNavigation", () => {
  it("returns the same navigation when nothing needs to change", () => {
    const navigation: SignerNavigation = { view: "manage", publicKeyZ32: "ready" };
    expect(resolveSignerNavigation(navigation, context([READY]))).toBe(navigation);
    const home: SignerNavigation = { view: "home" };
    expect(resolveSignerNavigation(home, context([READY]))).toBe(home);
  });

  it("stays home when the active identity's profile is unfinished", () => {
    const home: SignerNavigation = { view: "home" };
    expect(resolveSignerNavigation(home, context([UNFINISHED]))).toBe(home);
    expect(initialSignerNavigation(context([UNFINISHED]), null)).toEqual({ view: "home" });
    const navigation: SignerNavigation = { view: "switch" };
    expect(resolveSignerNavigation(navigation, context([UNFINISHED]))).toBe(navigation);
  });

  it("opens addition from home when nothing is saved", () => {
    expect(resolveSignerNavigation({ view: "home" }, context([]))).toEqual({
      view: "add",
      back: null,
    });
  });

  it.each([
    { view: "manage", publicKeyZ32: "gone" },
    { view: "recovery", publicKeyZ32: "gone" },
    { view: "ring", publicKeyZ32: "gone" },
    { view: "backup-to-google", publicKeyZ32: "gone" },
    { view: "finish-add", publicKeyZ32: "gone" },
    { view: "profile", publicKeyZ32: "gone", from: "manage" },
  ] as const satisfies readonly SignerNavigation[])(
    "leaves $view when its identity is no longer saved",
    (navigation) => {
      expect(resolveSignerNavigation(navigation, context([READY]))).toEqual({ view: "home" });
      expect(resolveSignerNavigation(navigation, context([]))).toEqual({
        view: "add",
        back: null,
      });
    },
  );

  it("keeps detachment on the identity it started with", () => {
    const navigation: SignerNavigation = {
      view: "detach",
      identity: READY,
      googleAccount: {
        googleSubject: "google",
        email: "a@example.com",
        name: "A",
        pictureUrl: null,
      },
    };
    expect(resolveSignerNavigation(navigation, context([]))).toBe(navigation);
  });
});

describe("requiresProfileSetup", () => {
  it("reads the flag from the result or from the saved identity", () => {
    expect(requiresProfileSetup(UNFINISHED, context([]).catalog)).toBe(true);
    expect(
      requiresProfileSetup(
        { publicIdentity: UNFINISHED.publicIdentity },
        context([UNFINISHED]).catalog,
      ),
    ).toBe(true);
    expect(requiresProfileSetup(READY, context([READY]).catalog)).toBe(false);
  });
});

describe("connecting Ring from the add screen", () => {
  it("stays on the connection while its identity is being added", () => {
    const connect: SignerNavigation = { view: "connect-ring", back: "switch" };
    expect(resolveSignerNavigation(connect, context([READY]))).toBe(connect);
    expect(resolveSignerNavigation({ view: "connect-ring", back: null }, context([]))).toEqual({
      view: "connect-ring",
      back: null,
    });
  });
});
