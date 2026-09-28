import { describe, expect, it } from "vitest";

import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  initialSignerNavigation,
  pendingProfileSetup,
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
  deferred: readonly string[] = [],
) {
  const catalog: LocalIdentityCatalog = { activePublicKeyZ32: active, identities };
  return { catalog, deferredProfiles: new Set(deferred) };
}

describe("pendingProfileSetup", () => {
  it("returns only the active identity whose setup was not put off", () => {
    expect(pendingProfileSetup(context([UNFINISHED]))).toBe(UNFINISHED);
    expect(pendingProfileSetup(context([UNFINISHED, READY], "ready"))).toBeUndefined();
    expect(
      pendingProfileSetup(context([UNFINISHED], "unfinished", ["unfinished"])),
    ).toBeUndefined();
    expect(pendingProfileSetup(context([READY]))).toBeUndefined();
    expect(pendingProfileSetup(context([UNFINISHED], null))).toBeUndefined();
  });
});

describe("Ring profile setup with a pending request", () => {
  const UNFINISHED_RING: LocalIdentityMetadata = { ...UNFINISHED, keySource: "ring" };

  it("waits until no app request is under review", () => {
    const pending = { ...context([UNFINISHED_RING]), requestPending: true };
    expect(pendingProfileSetup(pending)).toBeUndefined();
    expect(resolveSignerNavigation({ view: "home" }, pending)).toEqual({ view: "home" });
    expect(initialSignerNavigation(pending, null)).toEqual({ view: "home" });
    expect(resolveSignerNavigation({ view: "home" }, context([UNFINISHED_RING]))).toEqual({
      view: "profile",
      publicKeyZ32: "unfinished",
    });
  });

  it("still opens a local identity's setup before the request", () => {
    const pending = { ...context([UNFINISHED]), requestPending: true };
    expect(pendingProfileSetup(pending)).toBe(UNFINISHED);
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

  it("puts due profile setup before a resumed account setup", () => {
    const navigation = initialSignerNavigation(context([UNFINISHED]), {
      ...DRAFT,
      registrationStarted: true,
    });
    expect(resolveSignerNavigation(navigation, context([UNFINISHED]))).toEqual({
      view: "profile",
      publicKeyZ32: "unfinished",
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

  it("opens due profile setup from home until it is put off", () => {
    expect(resolveSignerNavigation({ view: "home" }, context([UNFINISHED]))).toEqual({
      view: "profile",
      publicKeyZ32: "unfinished",
    });
    expect(
      resolveSignerNavigation(
        { view: "home" },
        context([UNFINISHED], "unfinished", ["unfinished"]),
      ),
    ).toEqual({ view: "home" });
  });

  it("does not interrupt other screens for due profile setup", () => {
    const navigation: SignerNavigation = { view: "switch" };
    expect(resolveSignerNavigation(navigation, context([UNFINISHED]))).toBe(navigation);
  });

  it("opens addition from home when nothing is saved", () => {
    expect(resolveSignerNavigation({ view: "home" }, context([]))).toEqual({
      view: "add",
      back: null,
    });
  });

  it.each(["manage", "recovery", "ring", "backup-to-google", "finish-add", "profile"] as const)(
    "leaves %s when its identity is no longer saved",
    (view) => {
      expect(resolveSignerNavigation({ view, publicKeyZ32: "gone" }, context([READY]))).toEqual({
        view: "home",
      });
      expect(resolveSignerNavigation({ view, publicKeyZ32: "gone" }, context([]))).toEqual({
        view: "add",
        back: null,
      });
    },
  );

  it("keeps detachment on the identity it started with", () => {
    const navigation: SignerNavigation = {
      view: "detach",
      identity: READY,
      googleSubject: "google",
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
