/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { PermissionList } from "./permissionList";

type Capability = AuthorizationRequestReview["capabilities"][number];

const NOTES: Capability = {
  path: "/pub/notes.acme.example/",
  read: true,
  write: true,
  scope: "specific",
};

function renderList(capabilities: Capability[], callbackHost?: string) {
  render(<PermissionList callbackHost={callbackHost} capabilities={capabilities} />);
  return screen.queryByRole("list", { name: /^Requested permissions/u });
}

describe("PermissionList", () => {
  afterEach(cleanup);

  it("lists each capability with a plain title, its exact path and a spelled-out access chip", () => {
    const list = renderList(
      [
        NOTES,
        { path: "/pub/feeds.example/", read: true, write: false, scope: "specific" },
        { path: "/priv/notes.acme.example/", read: false, write: true, scope: "specific" },
      ],
      "notes.acme.example",
    );

    expect(
      within(list!)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "This app's own data, /pub/notes.acme.example/, Read & write",
      "Another app's data: “feeds.example”, /pub/feeds.example/, Read only",
      "This app's own private data, /priv/notes.acme.example/, Write only",
    ]);
    // Explicit, because WebKit drops the implicit role of a list without markers.
    expect(list).toHaveAttribute("role", "list");
  });

  it("names Pubky social data and Locks by what keeps them, with no broad flag", () => {
    const list = renderList(
      [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/priv/social/", read: true, write: true, scope: "specific" },
        { path: "/priv/app.locks/content/", read: true, write: false, scope: "specific" },
      ],
      "pubky.app",
    );

    expect(
      within(list!)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Your public Pubky social data, Profile, posts, tags and follows, /pub/pubky.app/, Read & write",
      "Your private Pubky social data, Drafts, bookmarks and mutes, /priv/social/, Read & write",
      "Part of your Locks content, Private content you share only with paying or approved people, /priv/app.locks/content/, Read only",
    ]);
    expect(screen.queryByText(/Broad access/u)).toBeNull();
    expect(list!.closest("section")).toHaveClass("border-border");
  });

  it("shows a path's long stacks of combining marks cut, clipped to its own row", () => {
    const marks = "\u0336".repeat(60);
    const list = renderList([
      { path: `/pub/evil${marks}.example/`, read: true, write: false, scope: "specific" },
    ]);

    const [row] = within(list!).getAllByRole("listitem");
    const shown = `/pub/evil${"\u0336".repeat(3)}.example/`;
    expect(row?.textContent).toBe(
      `An app's data: “evil${"\u0336".repeat(3)}.example”, ${shown}, Read only`,
    );
    const path = row?.querySelector("bdi.font-mono");
    expect(path).toHaveTextContent(shown);
    expect(path).toHaveClass("overflow-hidden");
    expect(path?.previousElementSibling?.previousElementSibling).toHaveClass("overflow-hidden");
  });

  it("keeps the card neutral when every capability is scoped to an app", () => {
    renderList([NOTES]);

    const heading = screen.getByRole("heading", { name: "Requested permissions" });
    expect(heading).toHaveClass("text-muted-foreground");
    expect(heading.closest("section")).toHaveClass("border-border");
    expect(screen.getByText("Read & write")).not.toHaveClass("text-brand");
  });

  it("flags a broad capability in its row and on the card", () => {
    const list = renderList([NOTES, { path: "/", read: true, write: true, scope: "broad" }]);

    const [scoped, broad] = within(list!).getAllByRole("listitem");
    expect(broad).toHaveTextContent("Broad access: All your data, /, Read & write");
    expect(within(broad!).getByText("All your data")).toHaveClass("text-destructive-text");
    expect(within(scoped!).getByText(/An app's data/u)).not.toHaveClass("text-destructive-text");
    expect(screen.getByRole("heading").closest("section")).toHaveClass(
      "border-destructive-text/40",
    );
  });

  it("offers line breaks after each slash and dot instead of breaking inside names", () => {
    renderList([NOTES]);

    const path = screen.getByText(
      (_, element) => element?.classList.contains("font-mono") ?? false,
    );
    expect(path).toHaveTextContent(NOTES.path);
    expect(path).toHaveClass("font-mono", "text-muted-foreground");
    expect(path).not.toHaveClass("break-all");
    // "/", "pub/", "notes.", "acme.", "example/": one break opportunity between each.
    expect(path.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("says so outside the list when nothing is requested", () => {
    expect(renderList([])).toBeNull();
    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
  });

  it("keeps a short list whole and in the requested order", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
    }));
    const list = renderList([...six.slice(0, 5), { ...NOTES, path: "/", scope: "broad" }]);

    expect(within(list!).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list!).getAllByRole("listitem")[5]).toHaveTextContent("All your data");
    expect(screen.getByRole("heading", { name: "Requested permissions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show/u })).not.toBeInTheDocument();
  });

  it("isolates an app-supplied folder name in quotes, left to right", () => {
    const name = "your data \u05D0\u05D1 approved";
    const list = renderList([{ ...NOTES, path: `/pub/${name}/notes/` }], "notes.acme.example");

    const title = within(list!).getByText(/Some of another app's data/u);
    expect(title).toHaveTextContent(`Some of another app's data: “${name}”`);
    const folder = within(title).getByText(name);
    expect(folder.tagName).toBe("BDI");
    expect(folder).toHaveAttribute("dir", "ltr");
  });

  it("lets a long folder name wrap after its dots before breaking inside a word", () => {
    const list = renderList([{ ...NOTES, path: "/pub/inbox.acme.example/" }], "notes.acme.example");

    const folder = within(list!).getByText(
      (_, element) =>
        element?.tagName === "BDI" &&
        element.getAttribute("dir") === "ltr" &&
        !element.classList.contains("font-mono"),
    );
    expect(folder).toHaveTextContent("inbox.acme.example");
    expect(folder.querySelectorAll("wbr")).toHaveLength(2);
  });

  it("folds only the app's own folder, so the app's order cannot hide a sensitive row", async () => {
    // Six rows in its own folder first, then all of the Pubky App's data seventh.
    const own = "abcdef".split("").map((folder) => ({
      ...NOTES,
      path: `/pub/evil.app/${folder}/`,
    }));
    const pubkyApp: Capability = { ...NOTES, path: "/pub/pubky.app/" };
    const list = renderList([...own, pubkyApp], "evil.app");

    expect(screen.getByRole("heading", { name: "Requested permissions (7)" })).toBeVisible();
    const rows = within(list!).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(
      "Your public Pubky social data, Profile, posts, tags and follows, /pub/pubky.app/, Read & write",
    );
    expect(rows[1]).toHaveTextContent("Some of this app's own data");

    const toggle = screen.getByRole("button", { name: "Show 2 more of this app's own data" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", list!.id);
    await userEvent.setup().click(toggle);

    expect(within(list!).getAllByRole("listitem")).toHaveLength(7);
    expect(within(list!).getAllByRole("listitem")[0]).toHaveTextContent(
      "Your public Pubky social data",
    );
    expect(screen.getByRole("button", { name: "Show fewer permissions" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("never folds broad, private or other apps' rows, however many there are", () => {
    const others = Array.from({ length: 6 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
    }));
    const list = renderList(
      [
        { ...NOTES, path: "/pub/evil.app/notes/" },
        ...others,
        { path: "/priv/", read: true, write: true, scope: "broad" },
        { ...NOTES, path: "/priv/evil.app/" },
      ],
      "evil.app",
    );

    // Only the one row in its own public folder could fold, and eight others stay in view.
    const rows = within(list!).getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("All your private data");
    expect(rows.map((row) => row.textContent).join()).toContain("This app's own private data");
    expect(
      screen.getByRole("button", { name: "Show 1 more of this app's own data" }),
    ).toBeVisible();
  });

  it("never folds a request that names no website", () => {
    const specific = Array.from({ length: 12 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
    }));
    const list = renderList(specific);

    expect(within(list!).getAllByRole("listitem")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /^Show/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requested permissions" })).toBeInTheDocument();
  });
});
