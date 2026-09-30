/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { AuthorizationReview } from "./authorizationReview";

const LOOK_ALIKE_HOST = "accounts.google.com.sign-in.secure-verify.attacker.example";
const NO_WEBSITE_NOTICE =
  "This request doesn't name a website. Only continue if you just started signing in on another device.";

const KEY = "p37b3zjjsn5a9wj46uniud9x6uz1ifaspa6kphzr9x6c5ynomxao";

/** The paragraph that says what the app will see and what authorizing allows. */
function trustParagraph() {
  return screen.getByText(/^Authorizing will allow/u).closest("p");
}

function renderReview(
  review: Partial<AuthorizationRequestReview>,
  identity: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: KEY } },
) {
  return render(
    <AuthorizationReview
      identity={identity}
      onAuthorize={vi.fn()}
      onCancel={vi.fn()}
      onSwitch={vi.fn()}
      phase="review"
      review={{
        authenticationMethod: "cookie",
        capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
        ...review,
      }}
    />,
  );
}

describe("AuthorizationReview", () => {
  afterEach(cleanup);

  it("names the callback host under an app label that differs from it", () => {
    renderReview({ callbackHost: LOOK_ALIKE_HOST, requesterName: "Google" });

    expect(screen.getByRole("heading", { name: "Sign in to Google" })).toBeInTheDocument();
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
    expect(screen.queryByText(/doesn't name a website/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(
      screen.getByText(/^Authorizing will allow [^(]+ to read and update/u),
    ).toBeInTheDocument();
  });

  it.each([
    ["an app label", { requesterName: "Google" }, "Sign in to Google"],
    ["no label", {}, "Sign in to this service"],
  ])(
    "says the request names no website when it has no callbacks and %s",
    (_case, review, heading) => {
      renderReview(review);

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.queryByText(/^Website:/u)).not.toBeInTheDocument();
      expect(screen.getByText(NO_WEBSITE_NOTICE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Authorize" })).toHaveAccessibleDescription(
        NO_WEBSITE_NOTICE,
      );
    },
  );

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

  it("does not ask twice to continue only after starting the sign-in", () => {
    renderReview({});

    // The notice under the heading already says so for a request without a website.
    expect(trustParagraph()).not.toHaveTextContent(/Only continue/u);
    expect(screen.getAllByText(/Only continue if you just started/u)).toHaveLength(1);
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
      // It wraps beside Cancel instead of overflowing the narrow desktop column.
      expect(action).toHaveClass("md:whitespace-normal");
      expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
      expect(screen.getByText(/^Allowing this lets/u)).toHaveTextContent(
        `Allowing this lets notes.example ${effect}`,
      );
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
