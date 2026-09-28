/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { AuthorizationReview } from "./authorizationReview";

const LOOK_ALIKE_HOST = "accounts.google.com.sign-in.secure-verify.attacker.example";
const NO_WEBSITE_NOTICE =
  "This request doesn't name a website. Only continue if you just started signing in on another device.";

function renderReview(review: Partial<AuthorizationRequestReview>) {
  return render(
    <AuthorizationReview
      identity={{
        publicIdentity: { publicKeyZ32: "p37b3zjjsn5a9wj46uniud9x6uz1ifaspa6kphzr9x6c5ynomxao" },
      }}
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
});
