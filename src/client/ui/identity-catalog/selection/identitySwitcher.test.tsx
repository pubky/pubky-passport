/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySwitcher } from "./identitySwitcher";

const IDENTITIES = [
  {
    publicIdentity: { publicKeyZ32: "firstidentity1234" },
    profile: { name: "Other Account" },
    googleAccount: {
      googleSubject: "google-1",
      email: "other@gmail.com",
      name: "Google Other",
      pictureUrl: null,
    },
  },
  {
    publicIdentity: { publicKeyZ32: "secondidentity5678" },
    profile: { name: "Active Account" },
    googleAccount: {
      googleSubject: "google-2",
      email: "active@gmail.com",
      name: "Google Active",
      pictureUrl: null,
    },
  },
];

describe("IdentitySwitcher", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("marks the active identity and selects another identity", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    render(
      <IdentitySwitcher
        activePublicKeyZ32="secondidentity5678"
        identities={IDENTITIES}
        onAddIdentity={vi.fn()}
        onBack={onBack}
        onSelect={onSelect}
      />,
    );

    // A list of identities with the active one as its current item, not a toggle button.
    const list = screen.getByRole("list", { name: "Saved identities" });
    // Explicit, so WebKit keeps the list (and its count) despite the removed markers.
    expect(list).toHaveAttribute("role", "list");
    expect(screen.getByRole("heading", { level: 2, name: "Saved identities" })).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(IDENTITIES.length);
    const activeRow = within(list).getByRole("button", { name: /Active Account/ });
    expect(activeRow).toHaveAttribute("aria-current", "true");
    expect(within(list).getAllByRole("button", { current: true })).toEqual([activeRow]);
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { pressed: false })).not.toBeInTheDocument();
    // The row is the Pubky profile; Google appears only as the small attached-account tag.
    expect(activeRow).toHaveTextContent("seco...5678");
    expect(activeRow).not.toHaveTextContent("Google Active");
    expect(
      screen.getByRole("group", { name: "Attached Google account: active@gmail.com" }),
    ).toBeInTheDocument();
    const otherRow = screen.getByRole("button", { name: /Other Account/ });
    expect(otherRow).toHaveTextContent("other@gmail.com");
    expect(otherRow).toHaveTextContent("firs...1234");
    await userEvent.setup().click(otherRow);
    expect(onSelect).toHaveBeenCalledWith("firstidentity1234");
    const back = screen.getByRole("button", { name: "Back" });
    const addIdentity = screen.getByRole("button", { name: "Add identity" });
    expect([back, addIdentity]).toEqual(
      screen
        .getAllByRole("button")
        .filter((button) => ["Back", "Add identity"].includes(button.textContent ?? "")),
    );
    expect(back.parentElement).toHaveClass("mt-auto", "md:mt-0");
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps mobile focus order aligned with the visual action order", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        () =>
          ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    );
    render(
      <IdentitySwitcher
        activePublicKeyZ32="secondidentity5678"
        identities={IDENTITIES}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen
        .getAllByRole("button")
        .filter((button) => ["Back", "Add identity"].includes(button.textContent ?? ""))
        .map((button) => button.textContent),
    ).toEqual(["Add identity", "Back"]);
  });

  it("shows the shortened Pubky when an identity has no Google account", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32="localidentity1234"
        identities={[{ publicIdentity: { publicKeyZ32: "localidentity1234" } }]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const localKey = screen.getByText("loca...1234");
    expect(localKey).toHaveClass("lowercase");
    expect(screen.getByRole("button", { name: /Your Pubky/ })).toContainElement(localKey);
  });

  it("notes a Ring-held key outside the lowercase key line", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32={null}
        identities={[{ publicIdentity: { publicKeyZ32: "ringidentity1234" }, keySource: "ring" }]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const note = screen.getByText("Key in Pubky Ring");
    expect(note).not.toHaveClass("lowercase");
    expect(note.closest(".lowercase")).toBeNull();
    expect(screen.getByText("ring...1234")).toHaveClass("lowercase");
    expect(screen.getByRole("button", { name: /Your Pubky/ })).toContainElement(note);
  });
});
