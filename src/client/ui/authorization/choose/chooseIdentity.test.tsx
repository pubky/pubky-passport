/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { ChooseIdentity } from "./chooseIdentity";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
  callbackHost: "notes.example",
  requesterName: "Acme Notes",
} as const;
const PLAIN: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "plainidentity1234" },
  profile: { name: "Plain" },
};
const RING: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "ringidentity5678" },
  keySource: "ring",
};

function renderChooser(identities: readonly LocalIdentityMetadata[], active: string | null) {
  const handlers = {
    onCancel: vi.fn(),
    onCreateAccount: vi.fn(),
    onMoreOptions: vi.fn(),
    onOpenRing: vi.fn(),
    onSelect: vi.fn(),
  };
  render(
    <ChooseIdentity
      activePublicKeyZ32={active}
      identities={identities}
      moreOptionsLabel="Continue with Google or import a backup"
      review={REVIEW}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ChooseIdentity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists every identity, the last used first, above the other ways in", async () => {
    const handlers = renderChooser([PLAIN, RING], RING.publicIdentity.publicKeyZ32);

    expect(screen.getByRole("heading", { name: "Sign in to Acme Notes" })).toBeInTheDocument();
    expect(screen.getByText("Website:", { exact: false })).toHaveTextContent("notes.example");
    const rows = within(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Key in Pubky Ring"),
      expect.stringContaining("Plain"),
    ]);
    for (const row of rows) expect(row).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toHaveClass("bg-secondary");
    // The count shows how far the list scrolls in a short window.
    expect(screen.getByText("2 identities")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(rows[1]!);
    await user.click(screen.getByRole("button", { name: "Open in Pubky Ring" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.click(
      screen.getByRole("button", { name: "Continue with Google or import a backup" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onSelect).toHaveBeenCalledWith(PLAIN.publicIdentity.publicKeyZ32);
    expect(handlers.onOpenRing).toHaveBeenCalledOnce();
    expect(handlers.onCreateAccount).toHaveBeenCalledOnce();
    expect(handlers.onMoreOptions).toHaveBeenCalledOnce();
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });

  it("brings a row reached by keyboard fully into the list's view, but not a pressed one", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom has no focus heuristics; the browser matches :focus-visible for keyboard focus only.
    let keyboard = false;
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ":focus-visible" ? keyboard : matches.call(this, selector);
    });
    renderChooser([PLAIN, RING], null);
    const rows = within(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).getAllByRole("button");
    const user = userEvent.setup();

    await user.click(rows[0]!);
    expect(scrollIntoView).not.toHaveBeenCalled();
    keyboard = true;
    await user.tab();
    expect(rows[1]).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("recommends creating an account when nothing is saved", () => {
    renderChooser([], null);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
    expect(screen.getByText(/Create your Pubky account to sign in/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toHaveClass("bg-brand/16");
    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).toHaveClass("bg-secondary");
  });

  it("names identities from the summary this browser kept, without reading profiles", () => {
    renderChooser(
      [
        {
          publicIdentity: { publicKeyZ32: "summaryidentity9" },
          // The screen shows whatever the display catalog carries; it has no loader of its own.
          profile: { name: "Remembered" },
          avatarUrl: "data:image/jpeg;base64,AAAA",
        },
      ],
      null,
    );
    const row = screen.getByRole("button", { name: /Remembered/u });
    expect(row.querySelector("img")).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
    expect(screen.queryByText(/identities$/u)).not.toBeInTheDocument();
  });

  it("warns about broad access before the request can go to Pubky Ring", () => {
    render(
      <ChooseIdentity
        activePublicKeyZ32={null}
        identities={[]}
        moreOptionsLabel="Import a backup"
        onCancel={vi.fn()}
        onCreateAccount={vi.fn()}
        onMoreOptions={vi.fn()}
        onOpenRing={vi.fn()}
        onSelect={vi.fn()}
        review={{
          ...REVIEW,
          capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This app asks for access to all your data, public and private.",
    );
  });

  it("never presents the app's label as the verified website", () => {
    render(
      <ChooseIdentity
        activePublicKeyZ32={null}
        identities={[PLAIN]}
        moreOptionsLabel="Import a backup"
        onCancel={vi.fn()}
        onCreateAccount={vi.fn()}
        onMoreOptions={vi.fn()}
        onOpenRing={vi.fn()}
        onSelect={vi.fn()}
        review={{ authenticationMethod: "cookie", capabilities: [], requesterName: "Bank" }}
        selectionFailed
      />,
    );

    expect(screen.getByRole("heading", { name: "Sign in to Bank" })).toBeInTheDocument();
    expect(screen.getByText(/doesn't name a website/u)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not choose this identity.");
  });
});
