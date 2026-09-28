/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
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

function renderList(capabilities: Capability[]) {
  render(<PermissionList capabilities={capabilities} />);
  return screen.queryByRole("list", { name: "Requested permissions" });
}

describe("PermissionList", () => {
  afterEach(cleanup);

  it("lists each capability with its path and a spelled-out access chip", () => {
    const list = renderList([
      NOTES,
      { path: "/pub/feeds.example/", read: true, write: false, scope: "specific" },
      { path: "/pub/inbox.example/", read: false, write: true, scope: "specific" },
    ]);

    expect(
      within(list!)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "/pub/notes.acme.example/, Read & write",
      "/pub/feeds.example/, Read only",
      "/pub/inbox.example/, Write only",
    ]);
    // Explicit, because WebKit drops the implicit role of a list without markers.
    expect(list).toHaveAttribute("role", "list");
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
    expect(broad).toHaveTextContent("Broad access: /, Read & write");
    expect(broad!.querySelector("bdi")).toHaveClass("text-destructive");
    expect(scoped!.querySelector("bdi")).not.toHaveClass("text-destructive");
    expect(screen.getByRole("heading").closest("section")).toHaveClass("border-destructive/40");
  });

  it("offers line breaks after each slash and dot instead of breaking inside names", () => {
    renderList([NOTES]);

    const path = screen.getByText((_, element) => element?.tagName === "BDI");
    expect(path).toHaveTextContent(NOTES.path);
    expect(path).not.toHaveClass("break-all");
    // "/", "pub/", "notes.", "acme.", "example/": one break opportunity between each.
    expect(path.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("says so outside the list when nothing is requested", () => {
    expect(renderList([])).toBeNull();
    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
  });
});
