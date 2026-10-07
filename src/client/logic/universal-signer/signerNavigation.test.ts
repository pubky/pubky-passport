import { describe, expect, it } from "vitest";

import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  initialSignerNavigation,
  requiresProfileSetup,
  resolveSignerNavigation,
  soleSigningIdentityToSelect,
  type SignerNavigation,
} from "./signerNavigation";

const READY: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: "ready" } };
const UNFINISHED: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "unfinished" },
  profileSetupRequired: true,
};
const RING: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: "ring" }, keySource: "ring" };
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

describe("soleSigningIdentityToSelect", () => {
  it("names the only identity that can sign while a key in Pubky Ring is active", () => {
    const catalog = (identities: LocalIdentityMetadata[], active: string | null) => ({
      activePublicKeyZ32: active,
      identities,
    });
    expect(soleSigningIdentityToSelect(catalog([READY, RING], "ring"))).toBe("ready");
    expect(soleSigningIdentityToSelect(catalog([READY], null))).toBe("ready");
    // Already active, more than one to choose from, or none: nothing to choose for the person.
    expect(soleSigningIdentityToSelect(catalog([READY, RING], "ready"))).toBeUndefined();
    expect(soleSigningIdentityToSelect(catalog([READY, UNFINISHED, RING], "ring"))).toBeUndefined();
    expect(soleSigningIdentityToSelect(catalog([RING], "ring"))).toBeUndefined();
    expect(soleSigningIdentityToSelect(catalog([], null))).toBeUndefined();
  });
});

describe("an app's request", () => {
  it("opens on the review for one identity, the list for more, or the start page for none", () => {
    // One saved, active identity goes straight to the review.
    expect(initialSignerNavigation(context([READY], "ready", true), null)).toEqual({
      view: "home",
    });
    // Not active, or one of several: the person picks first.
    expect(initialSignerNavigation(context([READY], null, true), null)).toEqual({
      view: "choose",
    });
    expect(initialSignerNavigation(context([READY, UNFINISHED], "ready", true), null)).toEqual({
      view: "choose",
    });
    expect(initialSignerNavigation(context([], null, true), null)).toEqual({
      view: "add",
      back: null,
      screen: "sign-in",
    });
  });

  it("resumes a submitted account setup with Back leading to the start page", () => {
    const draft = { ...DRAFT, registrationStarted: true };
    // Back leaves account creation for the start page, which returns to the list when there is one.
    expect(initialSignerNavigation(context([READY], "ready", true), draft)).toEqual({
      view: "create-account",
      back: "choose",
    });
    expect(initialSignerNavigation(context([], null, true), draft)).toEqual({
      view: "create-account",
      back: null,
    });
  });

  it("reviews the active identity from home and lists identities without one", () => {
    const home: SignerNavigation = { view: "home" };
    expect(resolveSignerNavigation(home, context([READY], "ready", true))).toBe(home);
    expect(resolveSignerNavigation(home, context([READY], null, true))).toEqual({
      view: "choose",
    });
    expect(resolveSignerNavigation(home, context([], null, true))).toEqual({
      view: "add",
      back: null,
    });
  });

  it("replaces the switcher with the list and keeps the list while the request waits", () => {
    expect(resolveSignerNavigation({ view: "switch" }, context([READY], "ready", true))).toEqual({
      view: "choose",
    });
    const choose: SignerNavigation = { view: "choose" };
    expect(resolveSignerNavigation(choose, context([READY], "ready", true))).toBe(choose);
  });

  it("shows the start page for an empty list, and keeps it once an identity is saved", () => {
    expect(resolveSignerNavigation({ view: "choose" }, context([], null, true))).toEqual({
      view: "add",
      back: null,
    });
    expect(resolveSignerNavigation({ view: "switch" }, context([], null, true))).toEqual({
      view: "add",
      back: null,
    });
    // An identity saved while the start page is open (Google restores, say) leaves the page to
    // the flow that saved it.
    const start: SignerNavigation = { view: "add", back: null };
    expect(resolveSignerNavigation(start, context([READY], "ready", true))).toBe(start);
    const another: SignerNavigation = { view: "add", back: "choose" };
    expect(resolveSignerNavigation(another, context([READY], "ready", true))).toBe(another);
  });

  it("never forces profile setup in front of the review", () => {
    const pending = context([UNFINISHED], "unfinished", true);
    expect(initialSignerNavigation(pending, null)).toEqual({ view: "home" });
    const home: SignerNavigation = { view: "home" };
    expect(resolveSignerNavigation(home, pending)).toBe(home);
  });

  it("opens on the review of the identity Authorize was pressed on, skipping the list", () => {
    const pending = context([READY, UNFINISHED], "ready", true);
    expect(initialSignerNavigation(pending, null)).toEqual({ view: "choose" });
    expect(initialSignerNavigation(pending, null, "ready")).toEqual({ view: "home" });
    // Only the active identity is reviewed: a note naming another one changes nothing.
    expect(initialSignerNavigation(pending, null, "unfinished")).toEqual({ view: "choose" });
    expect(initialSignerNavigation(pending, null, "gone")).toEqual({ view: "choose" });
    // The note never opens a review with a key held in Pubky Ring.
    expect(initialSignerNavigation(context([READY, RING], "ring", true), null, "ring")).toEqual({
      view: "choose",
    });
  });

  it("signs only with keys this browser holds: Ring identities are not counted", () => {
    const home: SignerNavigation = { view: "home" };
    const start = { view: "add", back: null };
    // Only Ring identities saved: the request opens as if nothing were saved.
    const onlyRing = context([RING], "ring", true);
    expect(initialSignerNavigation(onlyRing, null)).toEqual({ ...start, screen: "sign-in" });
    expect(resolveSignerNavigation(home, onlyRing)).toEqual(start);
    expect(resolveSignerNavigation({ view: "choose" }, onlyRing)).toEqual(start);
    expect(resolveSignerNavigation({ view: "switch" }, onlyRing)).toEqual(start);
    // An active Ring identity beside one that can sign: the person picks from the list.
    const ringActive = context([RING, READY], "ring", true);
    expect(initialSignerNavigation(ringActive, null)).toEqual({ view: "choose" });
    expect(resolveSignerNavigation(home, ringActive)).toEqual({ view: "choose" });
    // The one identity that can sign is active: its review opens, whatever Ring identities exist.
    const browserActive = context([RING, READY], "ready", true);
    expect(initialSignerNavigation(browserActive, null)).toEqual(home);
    expect(resolveSignerNavigation(home, browserActive)).toBe(home);
    // A submitted setup has no list to go back to while only Ring identities are saved.
    expect(initialSignerNavigation(onlyRing, { ...DRAFT, registrationStarted: true })).toEqual({
      view: "create-account",
      back: null,
    });
  });

  it("keeps a Ring identity's overview when no request is pending", () => {
    const home: SignerNavigation = { view: "home" };
    expect(initialSignerNavigation(context([RING], "ring"), null, "ring")).toEqual(home);
    expect(resolveSignerNavigation(home, context([RING], "ring"))).toBe(home);
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
    expect(initialSignerNavigation(context([]), null)).toEqual({
      view: "add",
      back: null,
      screen: "join",
    });
  });

  it.each(["join", "google", "sign-in", undefined] as const)(
    "opens an app's request with entry %s on its identities first, its screen only without",
    (entry) => {
      const none = context([], null, true);
      // The screen the app asked for never skips an identity that can sign: one goes to its
      // review, several to their list.
      expect(
        initialSignerNavigation(context([READY], "ready", true), null, undefined, entry),
      ).toEqual({ view: "home" });
      expect(
        initialSignerNavigation(
          context([READY, UNFINISHED], "ready", true),
          null,
          undefined,
          entry,
        ),
      ).toEqual({ view: "choose" });
      // Only with none to sign with does it pick the start page's screen (Sign in by default).
      expect(initialSignerNavigation(none, null, undefined, entry)).toEqual({
        view: "add",
        back: null,
        screen: entry ?? "sign-in",
      });
      // A key in Pubky Ring cannot sign the request, so it does not count.
      expect(
        initialSignerNavigation(context([RING], "ring", true), null, undefined, entry),
      ).toEqual({ view: "add", back: null, screen: entry ?? "sign-in" });
    },
  );

  it("starts home when identities exist", () => {
    expect(initialSignerNavigation(context([READY]), null)).toEqual({ view: "home" });
  });

  it("resumes only a submitted account setup", () => {
    expect(initialSignerNavigation(context([]), DRAFT)).toEqual({
      view: "add",
      back: null,
      screen: "join",
    });
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

  it("never manages a key held in Pubky Ring: every way to Manage and its screens leads home", () => {
    const saved = context([RING, READY], "ring");
    for (const navigation of [
      { view: "manage", publicKeyZ32: "ring" },
      { view: "manage", publicKeyZ32: "ring", logout: true },
      { view: "recovery", publicKeyZ32: "ring", home: true },
      { view: "ring", publicKeyZ32: "ring" },
      { view: "verify", publicKeyZ32: "ring" },
      { view: "verify", publicKeyZ32: "ring", from: "home" },
      { view: "backup-to-google", publicKeyZ32: "ring" },
    ] satisfies SignerNavigation[])
      expect(resolveSignerNavigation(navigation, saved)).toEqual({ view: "home" });
    // Its profile editor stays reachable, and a browser key keeps its Manage.
    const profile = { view: "profile", publicKeyZ32: "ring", from: "overview" } as const;
    expect(resolveSignerNavigation(profile, saved)).toBe(profile);
    const manage = { view: "manage", publicKeyZ32: "ready" } as const;
    expect(resolveSignerNavigation(manage, saved)).toBe(manage);
  });

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

describe("connecting Ring from the start page", () => {
  it("stays on the start page, which holds the connection, while its identity is being added", () => {
    const start: SignerNavigation = { view: "add", back: "switch" };
    expect(resolveSignerNavigation(start, context([READY]))).toBe(start);
    const first: SignerNavigation = { view: "add", back: null };
    expect(resolveSignerNavigation(first, context([]))).toBe(first);
    // The identity Ring approved is saved before the connection reports back.
    expect(resolveSignerNavigation(first, context([RING], "ring"))).toBe(first);
  });
});

describe("account creation", () => {
  it("keeps the verification method picked on the start page", () => {
    const create: SignerNavigation = { view: "create-account", back: null, method: "sms" };
    expect(resolveSignerNavigation(create, context([]))).toBe(create);
    expect(resolveSignerNavigation(create, context([READY], "ready", true))).toBe(create);
  });

  it("keeps the start screen it was opened from, and that screen's own Back, for its Back", () => {
    // A request's Sign in that Join opened: Back returns to Sign in, whose Back returns to Join.
    const fromSignIn: SignerNavigation = {
      view: "create-account",
      back: null,
      from: "sign-in",
      previous: "join",
    };
    expect(resolveSignerNavigation(fromSignIn, context([], null, true))).toBe(fromSignIn);
    expect(resolveSignerNavigation(fromSignIn, context([READY], "ready", true))).toBe(fromSignIn);
    const fromJoin: SignerNavigation = { view: "create-account", back: "home", from: "join" };
    expect(resolveSignerNavigation(fromJoin, context([READY]))).toBe(fromJoin);
  });
});

describe("an app's edit link", () => {
  it("keeps the editor of a key not saved, whose Ring connection says so, and its end screens", () => {
    const unsaved = { view: "profile", publicKeyZ32: "y".repeat(52), from: "edit" } as const;
    expect(resolveSignerNavigation(unsaved, context([READY], "ready"))).toBe(unsaved);
    const updated = { view: "profile-updated", told: false } as const;
    expect(resolveSignerNavigation(updated, context([READY], "ready"))).toBe(updated);
    const invalid = { view: "edit-invalid" } as const;
    expect(resolveSignerNavigation(invalid, context([], null))).toBe(invalid);
    // Any other editor for a key that is not saved falls back home.
    expect(
      resolveSignerNavigation({ ...unsaved, from: "overview" }, context([READY], "ready")),
    ).toEqual({ view: "home" });
  });
});
