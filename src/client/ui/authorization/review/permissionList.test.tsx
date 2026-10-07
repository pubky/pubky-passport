/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { GlobeIcon, LockIcon } from "@/client/ui/shared/icons";
import { PermissionList } from "./permissionList";

type Capability = AuthorizationRequestReview["capabilities"][number];

const NOTES: Capability = {
  path: "/pub/notes.acme.example/",
  read: true,
  write: true,
  scope: "specific",
};

const CHANGE = "Can read and change";
const READ = "Can only read";
const RULE =
  "Anyone can already see public data; private data is only visible to you and the apps you allow.";

function renderList(capabilities: Capability[], callbackHost?: string) {
  render(<PermissionList callbackHost={callbackHost} capabilities={capabilities} />);
}

/** Every row in view, group after group, as a screen reader reads it. */
function rowTexts(): (string | null)[] {
  return screen.queryAllByRole("listitem").map((item) => item.textContent);
}

/** The rows of one group, a list named by its heading. */
function groupRows(name: string): HTMLElement[] {
  return within(screen.getByRole("list", { name })).getAllByRole("listitem");
}

/** The exact path each row of a group shows, in order. */
function groupPaths(name: string): (string | null | undefined)[] {
  return groupRows(name).map((row) => row.querySelector("bdi.font-mono")?.textContent);
}

/** An icon's markup, to tell which one a row draws. */
function markup(icon: ReactElement): string {
  const { container, unmount } = render(icon);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("PermissionList", () => {
  afterEach(cleanup);

  it("lists each capability with a plain title, its exact path and a spelled-out access chip", () => {
    renderList(
      [
        NOTES,
        { path: "/pub/feeds.example/", read: true, write: false, scope: "specific" },
        { path: "/priv/notes.acme.example/", read: false, write: true, scope: "specific" },
      ],
      "notes.acme.example",
    );

    expect(groupRows(CHANGE).map((item) => item.textContent)).toEqual([
      "Private: This app's own private data, /priv/notes.acme.example/, Write only",
      "Public: This app's own data, /pub/notes.acme.example/, Read & write",
    ]);
    expect(groupRows(READ).map((item) => item.textContent)).toEqual([
      "Public: Another app's data: “feeds.example”, /pub/feeds.example/, Read only",
    ]);
    // Explicit, because WebKit drops the implicit role of a list without markers.
    for (const list of screen.getAllByRole("list")) expect(list).toHaveAttribute("role", "list");
  });

  it("names Pubky social data and Locks by what keeps them, with no broad flag", () => {
    renderList(
      [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/priv/social/", read: true, write: true, scope: "specific" },
        { path: "/priv/app.locks/content/", read: true, write: false, scope: "specific" },
      ],
      "pubky.app",
    );

    expect(rowTexts()).toEqual([
      "Private: Your private Pubky social data, Drafts, bookmarks and mutes, /priv/social/, Read & write",
      "Public: Your public Pubky social data, Profile, posts, tags and follows, /pub/pubky.app/, Read & write",
      "Private: Part of your Locks content, Private content you share only with paying or approved people, /priv/app.locks/content/, Read only",
    ]);
    expect(screen.queryByText(/Broad access/u)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Requested permissions" }).closest("section"),
    ).toHaveClass("border-border");
  });

  it("groups what the app can change above what it can only read, each a list of its own", () => {
    // Read-only rows first in the request, a write-only row last.
    renderList(
      [
        { path: "/pub/feeds.example/", read: true, write: false, scope: "specific" },
        { path: "/priv/feeds.example/", read: true, write: false, scope: "specific" },
        { path: "/pub/inbox.example/", read: false, write: true, scope: "specific" },
      ],
      "notes.acme.example",
    );

    const [change, read] = screen.getAllByRole("heading", { level: 3 });
    expect(change).toHaveTextContent(CHANGE);
    expect(read).toHaveTextContent(READ);
    expect(change!.compareDocumentPosition(read!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(groupRows(CHANGE)).toHaveLength(1);
    expect(groupRows(CHANGE)[0]).toHaveTextContent("/pub/inbox.example/, Write only");
    expect(groupPaths(READ)).toEqual(["/priv/feeds.example/", "/pub/feeds.example/"]);
  });

  it("leaves out a group with no rows", () => {
    renderList([{ ...NOTES, write: false }]);

    expect(screen.getByRole("heading", { level: 3, name: READ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CHANGE })).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("ranks a group broad first, then private, then public, the app's own public folder last", () => {
    const read = { read: true, write: false, scope: "specific" } as const;
    renderList(
      [
        { ...read, path: "/pub/notes.acme.example/" },
        { ...read, path: "/pub/feeds.example/" },
        { ...read, path: "/priv/notes.acme.example/" },
        { ...read, path: "/pub/", scope: "broad" },
        { ...read, path: "/priv/feeds.example/" },
      ],
      "notes.acme.example",
    );

    // Rows of the same rank keep the requested order.
    expect(groupPaths(READ)).toEqual([
      "/pub/",
      "/priv/notes.acme.example/",
      "/priv/feeds.example/",
      "/pub/feeds.example/",
      "/pub/notes.acme.example/",
    ]);
  });

  it("marks a private row with a lock and a public one with a globe, both named for screen readers", () => {
    const lock = markup(<LockIcon />);
    const globe = markup(<GlobeIcon />);
    renderList(
      [
        { path: "/priv/notes.acme.example/", read: true, write: true, scope: "specific" },
        NOTES,
        { path: "/", read: true, write: false, scope: "broad" },
      ],
      "notes.acme.example",
    );

    const [privateRow, publicRow] = groupRows(CHANGE);
    expect(within(privateRow!).getByText("Private:")).toHaveClass("sr-only");
    expect(privateRow!.firstElementChild!.innerHTML).toBe(lock);
    expect(privateRow!.firstElementChild).toHaveClass("text-foreground");
    expect(within(publicRow!).getByText("Public:")).toHaveClass("sr-only");
    expect(publicRow!.firstElementChild!.innerHTML).toBe(globe);
    expect(publicRow!.firstElementChild).toHaveClass("text-muted-foreground");
    // Public data is shown quieter than private data.
    expect(within(publicRow!).getByText("This app's own data")).toHaveClass(
      "text-secondary-foreground",
    );
    expect(within(privateRow!).getByText("This app's own private data")).toHaveClass(
      "text-foreground",
    );
    // A broad row is named broad, neither private nor public.
    const [broad] = groupRows(READ);
    expect(broad).toHaveTextContent(/^Broad access: All your data/u);
    expect(within(broad!).queryByText(/^(Private|Public):$/u)).toBeNull();
  });

  it("spells out each access, a row that can change data on a strong badge", () => {
    renderList([
      NOTES,
      { ...NOTES, path: "/pub/inbox.example/", read: false },
      { ...NOTES, path: "/pub/feeds.example/", write: false },
    ]);

    for (const access of ["Read & write", "Write only"])
      expect(screen.getByText(access)).toHaveClass("border-brand", "font-bold", "text-brand");
    const readOnly = screen.getByText("Read only");
    expect(readOnly).toHaveClass("border-input", "text-muted-foreground");
    expect(readOnly).not.toHaveClass("text-brand");
  });

  it("says under the list what public and private mean, only for a list that has both", () => {
    renderList([
      NOTES,
      { path: "/priv/notes.acme.example/", read: true, write: false, scope: "specific" },
    ]);
    expect(screen.getByText(RULE)).toBeInTheDocument();

    // One kind alone needs no comparison, and a short list stays short in the app's pop-up.
    cleanup();
    renderList([NOTES]);
    expect(screen.queryByText(RULE)).toBeNull();

    cleanup();
    renderList([
      { path: "/priv/notes.acme.example/", read: true, write: false, scope: "specific" },
    ]);
    expect(screen.queryByText(RULE)).toBeNull();

    cleanup();
    renderList([{ path: "/", read: true, write: true, scope: "broad" }]);
    expect(screen.queryByText(RULE)).toBeNull();

    cleanup();
    renderList([]);
    expect(screen.queryByText(RULE)).toBeNull();
  });

  it("shows a path's long stacks of combining marks cut, clipped to its own row", () => {
    const marks = "̶".repeat(60);
    renderList([
      { path: `/pub/evil${marks}.example/`, read: true, write: false, scope: "specific" },
    ]);

    const [row] = groupRows(READ);
    const shown = `/pub/evil${"̶".repeat(3)}.example/`;
    expect(row?.textContent).toBe(
      `Public: An app's data: “evil${"̶".repeat(3)}.example”, ${shown}, Read only`,
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
    expect(heading.closest("section")).not.toHaveClass("border-destructive-text/40");
  });

  it("flags a broad capability in its row and on the card", () => {
    renderList([NOTES, { path: "/", read: true, write: true, scope: "broad" }]);

    const [broad, scoped] = groupRows(CHANGE);
    expect(broad).toHaveTextContent("Broad access: All your data, /, Read & write");
    expect(within(broad!).getByText("All your data")).toHaveClass("text-destructive-text");
    expect(within(scoped!).getByText(/An app's data/u)).not.toHaveClass("text-destructive-text");
    expect(screen.getByRole("heading", { level: 2 }).closest("section")).toHaveClass(
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
    renderList([]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
  });

  it("keeps a short list whole, broad first and the rest in the requested order", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
    }));
    renderList([...six.slice(0, 5), { ...NOTES, path: "/", scope: "broad" }]);

    expect(groupPaths(CHANGE)).toEqual(["/", ...six.slice(0, 5).map(({ path }) => path)]);
    expect(groupRows(CHANGE)[0]).toHaveTextContent("All your data");
    expect(screen.getByRole("heading", { name: "Requested permissions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show/u })).not.toBeInTheDocument();
  });

  it("isolates an app-supplied folder name in quotes, left to right", () => {
    const name = "your data אב approved";
    renderList([{ ...NOTES, path: `/pub/${name}/notes/` }], "notes.acme.example");

    const title = screen.getByText(/Some of another app's data/u);
    expect(title).toHaveTextContent(`Some of another app's data: “${name}”`);
    const folder = within(title).getByText(name);
    expect(folder.tagName).toBe("BDI");
    expect(folder).toHaveAttribute("dir", "ltr");
  });

  it("lets a long folder name wrap after its dots before breaking inside a word", () => {
    renderList([{ ...NOTES, path: "/pub/inbox.acme.example/" }], "notes.acme.example");

    const folder = screen.getByText(
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
    renderList([...own, pubkyApp], "evil.app");

    expect(screen.getByRole("heading", { name: "Requested permissions (7)" })).toBeVisible();
    const rows = groupRows(CHANGE);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(
      "Public: Your public Pubky social data, Profile, posts, tags and follows, /pub/pubky.app/, Read & write",
    );
    expect(rows[1]).toHaveTextContent("Some of this app's own data");

    const toggle = screen.getByRole("button", { name: "Show 2 more of this app's own data" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(controlled).toContainElement(screen.getByRole("list", { name: CHANGE }));
    await userEvent.setup().click(toggle);

    expect(groupRows(CHANGE)).toHaveLength(7);
    expect(groupRows(CHANGE)[0]).toHaveTextContent("Your public Pubky social data");
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
    renderList(
      [
        { ...NOTES, path: "/pub/evil.app/notes/" },
        ...others,
        { path: "/priv/", read: true, write: true, scope: "broad" },
        { ...NOTES, path: "/priv/evil.app/" },
      ],
      "evil.app",
    );

    // Only the one row in its own public folder could fold, and eight others stay in view.
    const rows = groupRows(CHANGE);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("All your private data");
    expect(rows[1]).toHaveTextContent("This app's own private data");
    expect(rowTexts().join()).not.toContain("/pub/evil.app/notes/");
    expect(
      screen.getByRole("button", { name: "Show 1 more of this app's own data" }),
    ).toBeVisible();
  });

  it("folds own-folder rows from either group and keeps every other read-only row", () => {
    const own = "abcdef".split("").map((folder, index) => ({
      ...NOTES,
      path: `/pub/evil.app/${folder}/`,
      // The last two the app asks for are read-only.
      write: index < 4,
    }));
    const readOthers = Array.from({ length: 3 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
      write: false,
    }));
    renderList([...own, ...readOthers], "evil.app");

    // Three rows it may not fold, and two of its own folder, in the order it asked for them.
    expect(groupPaths(CHANGE)).toEqual(["/pub/evil.app/a/", "/pub/evil.app/b/"]);
    expect(groupPaths(READ)).toEqual(readOthers.map(({ path }) => path));
    expect(
      screen.getByRole("button", { name: "Show 4 more of this app's own data" }),
    ).toBeVisible();
  });

  it("never folds a request that names no website", () => {
    const specific = Array.from({ length: 12 }, (_, index) => ({
      ...NOTES,
      path: `/pub/app-${index}.example/`,
    }));
    renderList(specific);

    expect(groupRows(CHANGE)).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /^Show/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requested permissions" })).toBeInTheDocument();
  });
});
