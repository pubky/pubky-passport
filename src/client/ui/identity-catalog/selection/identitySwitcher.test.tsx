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
    // From lg the rows fill two columns of the wide track.
    expect(list).toHaveClass("lg:grid", "lg:grid-cols-2");
    const activeRow = within(list).getByRole("button", { name: /Active Account/ });
    expect(activeRow).toHaveAttribute("aria-current", "true");
    expect(within(list).getAllByRole("button", { current: true })).toEqual([activeRow]);
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { pressed: false })).not.toBeInTheDocument();
    // The row is the Pubky profile; Google appears only as the small attached-account tag.
    expect(activeRow).toHaveTextContent("seco…5678");
    expect(activeRow).not.toHaveTextContent("Google Active");
    expect(
      screen.getByRole("group", { name: "Attached Google account: active@gmail.com" }),
    ).toBeInTheDocument();
    const otherRow = screen.getByRole("button", { name: /Other Account/ });
    expect(otherRow).toHaveTextContent("other@gmail.com");
    expect(otherRow).toHaveTextContent("firs…1234");
    await userEvent.setup().click(otherRow);
    expect(onSelect).toHaveBeenCalledWith("firstidentity1234");
    const back = screen.getByRole("button", { name: "Back" });
    const addIdentity = screen.getByRole("button", { name: "Add identity" });
    expect([back, addIdentity]).toEqual(
      screen
        .getAllByRole("button")
        .filter((button) => ["Back", "Add identity"].includes(button.textContent ?? "")),
    );
    // The shared action row, pushed to the bottom of a phone screen.
    expect(back.parentElement?.parentElement).toHaveClass("mt-auto", "md:mt-0");
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("puts Back first at every width, like every other screen", () => {
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
    ).toEqual(["Back", "Add identity"]);
  });

  it("tells identities without a profile apart by their key, in the key's own case", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32="localidentity1234"
        identities={[
          { publicIdentity: { publicKeyZ32: "localidentity1234" } },
          { publicIdentity: { publicKeyZ32: "otheridentity9876" } },
        ]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    // The name already carries the key, so no key line repeats it; the face is not read out.
    // A key only in this browser gets no tag.
    const first = screen.getByRole("button", { name: "Pubky loca…1234" });
    const second = screen.getByRole("button", { name: /Pubky othe…9876/u });
    expect(screen.queryByText(/Your Pubky/u)).toBeNull();
    // No placeholder initials: pubky.app's face for each key, which the row's name covers.
    const avatars = [first, second].map((row) => row.querySelector("[data-facehash]"));
    expect(avatars[0]).toHaveAttribute("aria-hidden", "true");
    expect(avatars[0]).toHaveTextContent(/^L$/u);
    expect(avatars[1]).toHaveTextContent(/^O$/u);
    for (const row of [first, second])
      expect(row.querySelector(".lowercase, .uppercase")).toBeNull();
  });

  it("tags a Ring-held key and leaves a key only in this browser untagged", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32={null}
        identities={[
          {
            publicIdentity: { publicKeyZ32: "ringidentity1234" },
            profile: { name: "Ring" },
            keySource: "ring",
          },
          { publicIdentity: { publicKeyZ32: "localidentity1234" }, profile: { name: "Local" } },
        ]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const ring = screen.getByText("Key in Pubky Ring");
    expect(ring).toHaveClass("rounded-2xl", "border");
    expect(screen.getByRole("button", { name: /^Ring/u })).toContainElement(ring);
    expect(screen.getByRole("button", { name: /^Ring/u })).toHaveTextContent("ring…1234");
    expect(screen.getByRole("button", { name: /^Local/u })).not.toHaveTextContent(/Key in/u);
    expect(screen.queryByText("Key in this browser")).not.toBeInTheDocument();
  });
});
