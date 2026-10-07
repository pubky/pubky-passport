/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
import { AuthorizationReview } from "./authorizationReview";

const LOOK_ALIKE_HOST = "accounts.google.com.sign-in.secure-verify.attacker.example";
const UNVERIFIED_NOTICE = "Passport can’t confirm who sent this request.";

const KEY = "p37b3zjjsn5a9wj46uniud9x6uz1ifaspa6kphzr9x6c5ynomxao";

/** The paragraph that says what the app will see and what authorizing allows. */
function trustParagraph() {
  return screen.getByText(/^Authorizing will allow/u).closest("p");
}

function renderReview(
  review: Partial<AuthorizationRequestReview>,
  identity: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: KEY } },
  phase: ComponentProps<typeof AuthorizationReview>["phase"] = "review",
) {
  return render(
    <AuthorizationReview
      identity={identity}
      onAuthorize={vi.fn()}
      onCancel={vi.fn()}
      onSwitch={vi.fn()}
      phase={phase}
      review={{
        authenticationMethod: "cookie",
        capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
        ...review,
      }}
    />,
  );
}

describe("AuthorizationReview of a request a v2 hello bound", () => {
  // The app's popup, bound from the origin most requests here return to.
  beforeEach(() => bindTestOpener("https://notes.example"));
  afterEach(() => {
    cleanup();
    releaseTestOpener();
  });

  it("names the callback host under an app label that differs from it", () => {
    // Bound from the look-alike host itself, so no other origin is involved.
    releaseTestOpener();
    bindTestOpener(`https://${LOOK_ALIKE_HOST}`);
    renderReview({ callbackHost: LOOK_ALIKE_HOST, requesterName: "Google" });

    expect(screen.getByRole("heading", { name: "Signing in to Google" })).toBeInTheDocument();
    expect(screen.getByText(LOOK_ALIKE_HOST, { selector: "bdi" }).parentElement).toHaveTextContent(
      `Website: ${LOOK_ALIKE_HOST}`,
    );
    expect(screen.getByRole("button", { name: "Authorize" })).toHaveAccessibleDescription(
      `Website: ${LOOK_ALIKE_HOST}`,
    );
    expect(
      screen.getByText(
        `Authorizing will allow Google (${LOOK_ALIKE_HOST}) to read and update your data.`,
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["the heading already names the host", { callbackHost: "notes.example" }],
    [
      "the label is the host itself",
      { callbackHost: "notes.example", requesterName: "notes.example" },
    ],
  ])("adds no host line when %s", (_case, review) => {
    renderReview(review);

    expect(screen.queryByText(/^Website:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/can’t confirm who sent this request/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(
      screen.getByText(/^Authorizing will allow [^(]+ to read and update/u),
    ).toBeInTheDocument();
  });

  it.each([
    ["an app label", { requesterName: "Google" }, "Signing in to Google"],
    ["no label", {}, "Signing in to this service"],
  ])("names the bound app without callbacks and %s, with no notice", (_case, review, heading) => {
    renderReview(review);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/^Website:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(UNVERIFIED_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it.each([
    [["/"], "This app asks for access to all your data, public and private."],
    [["/pub/", "/priv/"], "This app asks for access to all your data, public and private."],
    [
      ["/pub/"],
      "This app asks for all your public data, including the folders other apps keep for you.",
    ],
    [
      ["/priv/"],
      "This app asks for all your private data, including the folders other apps keep for you.",
    ],
    // Without the slash a grant still covers every folder on that side.
    [
      ["/pub"],
      "This app asks for all your public data, including the folders other apps keep for you.",
    ],
    [
      ["/priv"],
      "This app asks for all your private data, including the folders other apps keep for you.",
    ],
    [["/pub", "/priv"], "This app asks for access to all your data, public and private."],
    // Any other path the request model may come to mark broad still gets a warning.
    [
      ["/pub/shared/"],
      "This app asks for more than its own folder. It could reach the data other apps keep for you.",
    ],
  ])("flags broad access to %j with an icon and says what it reaches", (paths, warning) => {
    renderReview({
      capabilities: [
        { path: "/pub/notes.example/", read: true, write: true, scope: "specific" },
        ...paths.map((path) => ({ path, read: true, write: false, scope: "broad" as const })),
      ],
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(warning);
    expect(alert.querySelector("svg")).not.toBeNull();
  });

  it("raises no alert when every capability is scoped to an app", () => {
    renderReview({});

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("raises no alert and keeps Authorize for namespace-scoped private folders", () => {
    renderReview({
      callbackHost: "notes.example",
      capabilities: [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/priv/social/", read: true, write: true, scope: "specific" },
        { path: "/priv/app.locks/content/", read: true, write: false, scope: "specific" },
      ],
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
    expect(screen.getByText("/priv/social/")).toBeInTheDocument();
    expect(screen.getByText("/priv/app.locks/content/")).toBeInTheDocument();
  });

  it("says what the app will see, and never the secret key or the attached Google account", () => {
    renderReview(
      { callbackHost: "notes.example", requesterName: "Acme Notes" },
      {
        publicIdentity: { publicKeyZ32: KEY },
        googleAccount: {
          googleSubject: "google-1",
          name: "Alex",
          email: "alex@example.com",
          pictureUrl: null,
        },
      },
    );

    expect(trustParagraph()).toHaveTextContent(
      /^Only continue if you just started signing in to Acme Notes\. The app will see your public key \(p37b…mxao\) and your public profile, but not your secret key or your Google account\. Authorizing will allow/u,
    );
    // The short key reads as one value and never breaks at its ellipsis.
    expect(screen.getByText("(p37b…mxao)")).toHaveClass("whitespace-nowrap");
    expect(screen.queryByText(/Make sure you trust/u)).toBeNull();
  });

  it("names only the secret key for an identity without Google", () => {
    renderReview({ callbackHost: "notes.example" });

    expect(trustParagraph()).toHaveTextContent(
      /public profile, but not your secret key\. Authorizing will allow/u,
    );
  });

  it("keeps an empty status line of reserved height until an answer is on its way", () => {
    renderReview({ callbackHost: "notes.example" });

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    // Two lines where its copy wraps, one from md: the actions under it never move.
    expect(status).toHaveClass("min-h-10", "md:min-h-5");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it.each([
    [["/:rw"], "Allow changing all your data", "read and change all your data."],
    [["/pub/:r"], "Allow reading all public data", "read all your public data."],
    [["/priv/:w"], "Allow changing all private data", "change all your private data."],
    [["/pub/:r", "/priv/:rw"], "Allow changing all your data", "read and change all your data."],
    [["/pub:r"], "Allow reading all public data", "read all your public data."],
    [["/priv:w"], "Allow changing all private data", "change all your private data."],
  ])(
    "names what the broad capabilities %j give, in the action and the sentence",
    (caps, label, effect) => {
      renderReview({
        callbackHost: "notes.example",
        capabilities: caps.map((cap) => {
          const [path = "", access = ""] = cap.split(":");
          return {
            path,
            read: access.includes("r"),
            write: access.includes("w"),
            scope: "broad" as const,
          };
        }),
      });

      const action = screen.getByRole("button", { name: label });
      expect(action).toBeEnabled();
      // It wraps instead of overflowing the desktop column.
      expect(action).toHaveClass("md:whitespace-normal");
      expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
      expect(screen.getByText(/^Allowing this lets/u)).toHaveTextContent(
        `Allowing this lets notes.example ${effect}`,
      );
    },
  );

  it("puts Cancel in the header slot, Authorize alone below the request, then the other ways in", async () => {
    const handlers = {
      onAuthorize: vi.fn(),
      onCancel: vi.fn(),
      onUseAnotherIdentity: vi.fn(),
      onUseRing: vi.fn(),
    };
    render(
      <AuthorizationReview
        identity={{ publicIdentity: { publicKeyZ32: KEY } }}
        phase="review"
        review={{ authenticationMethod: "cookie", capabilities: [], callbackHost: "notes.example" }}
        {...handlers}
      />,
    );

    // One Cancel, the header's secondary button as on the identity list, before the request.
    const cancel = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancel).toHaveLength(1);
    expect(cancel[0]).toHaveClass("bg-secondary");
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(cancel[0]!.compareDocumentPosition(authorize)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(authorize).toHaveClass("w-full");
    // The same "or" as the list, after Authorize, so Authorize stays the primary action.
    const or = screen.getByText("or", { exact: true });
    expect(authorize.compareDocumentPosition(or)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const another = screen.getByRole("button", { name: "Use another identity" });
    const ring = screen.getByRole("button", { name: "Continue with keychain" });
    for (const other of [another, ring]) {
      expect(other).toHaveClass("bg-secondary");
      expect(or.compareDocumentPosition(other)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    // A single identity that can sign: nothing to switch to.
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(another);
    await user.click(ring);
    await user.click(cancel[0]!);
    expect(handlers.onUseAnotherIdentity).toHaveBeenCalledOnce();
    expect(handlers.onUseRing).toHaveBeenCalledOnce();
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    expect(handlers.onAuthorize).not.toHaveBeenCalled();
  });

  it.each([
    ["granting", undefined, "Cancel", true],
    ["completing", "cancel", "Cancelling…", false],
  ] as const)(
    "keeps the header's Cancel and the other ways in from starting anything while %s",
    (phase, phaseOutcome, cancelName, cancelDisabled) => {
      render(
        <AuthorizationReview
          identity={{ publicIdentity: { publicKeyZ32: KEY } }}
          onAuthorize={vi.fn()}
          onCancel={vi.fn()}
          onSwitch={vi.fn()}
          onUseAnotherIdentity={vi.fn()}
          onUseRing={vi.fn()}
          phase={phase}
          phaseOutcome={phaseOutcome}
          review={{ authenticationMethod: "cookie", capabilities: [] }}
        />,
      );

      const cancel = screen.getByRole("button", { name: cancelName });
      // The cancelling button shows its work and stays focusable; while signing it is disabled.
      if (cancelDisabled) expect(cancel).toBeDisabled();
      else expect(cancel).toHaveAttribute("aria-busy", "true");
      for (const name of ["Switch identity", "Use another identity", "Continue with keychain"])
        expect(screen.getByRole("button", { name })).toBeDisabled();
    },
  );

  it("points a broad request's sentence at its narrower rows too", () => {
    renderReview({
      capabilities: [
        { path: "/pub/notes.example/", read: true, write: true, scope: "specific" },
        { path: "/pub/", read: true, write: false, scope: "broad" },
      ],
    });

    expect(screen.getByRole("button", { name: "Allow reading all public data" })).toBeVisible();
    expect(screen.getByText(/^Allowing this lets/u)).toHaveTextContent(
      "Allowing this lets this service read all your public data, along with the other permissions listed.",
    );
  });
});

describe("AuthorizationReview of a request nobody verified (M3)", () => {
  afterEach(cleanup);

  it("names no website as the requester and warns once, above Authorize", () => {
    renderReview({ callbackHost: LOOK_ALIKE_HOST, requesterName: "Google" });

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.queryByText(/Signing in to|^Website:/u)).toBeNull();
    expect(screen.queryByText(LOOK_ALIKE_HOST)).toBeNull();
    expect(screen.getByText("Google", { selector: "bdi" }).parentElement).toHaveTextContent(
      "Name in the request: Google (unverified)",
    );
    const notice = screen.getByText(UNVERIFIED_NOTICE);
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(notice.compareDocumentPosition(authorize)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(authorize).toHaveAccessibleDescription(UNVERIFIED_NOTICE);
    // Every sentence says "the app", and the one over Authorize asks to continue only after
    // starting this sign-in, as it asks for a verified app by name.
    expect(trustParagraph()).toHaveTextContent(
      /^Only continue if you just started this sign-in yourself\. The app will see/u,
    );
    expect(trustParagraph()).not.toHaveTextContent(/Google/u);
    expect(
      screen.getByText("Authorizing will allow the app to read and update your data."),
    ).toBeVisible();
    expect(screen.getAllByText(/Only continue if you just started/u)).toHaveLength(1);
  });

  it("gives the warning's place to each step of the answer, so Authorize never moves", () => {
    const review = { callbackHost: "notes.example" };
    const { unmount } = renderReview(review);
    const notice = screen.getByText(UNVERIFIED_NOTICE).closest("[data-tone]");
    expect(notice).not.toHaveClass("invisible");
    // The status line under it waits, empty, for the first step.
    expect(notice!.nextElementSibling).toHaveAttribute("role", "status");
    expect(notice!.nextElementSibling).toBeEmptyDOMElement();
    unmount();

    renderReview(review, undefined, "granting");
    const status = screen.getByText("Sending your approval to the app. This can't be undone now.");
    const hidden = screen.getByText(UNVERIFIED_NOTICE).closest("[data-tone]");
    // One grid cell holds both: the hidden warning keeps its height under the step's text.
    expect(hidden).toHaveClass("invisible", "[grid-area:1/1]");
    expect(status).toHaveClass("[grid-area:1/1]");
    expect(status.parentElement).toBe(hidden!.parentElement);
    expect(status.parentElement).toHaveClass("grid");
    expect(
      status.parentElement!.compareDocumentPosition(
        screen.getByRole("button", { name: "Signing in…" }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("never calls a folder the app's own, and never folds a long list", () => {
    const folders = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({
      path: `/pub/notes.example/${name}/`,
      read: true,
      write: true,
      scope: "specific" as const,
    }));
    renderReview({ callbackHost: "notes.example", capabilities: folders });

    expect(screen.queryByText(/this app's own/iu)).toBeNull();
    expect(screen.getAllByText(/Some of an app's data/u)).toHaveLength(folders.length);
    expect(screen.queryByRole("button", { name: /more of this app's own data/u })).toBeNull();
  });
});
