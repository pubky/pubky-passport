/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileLinks } from "./profileLinks";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

describe("ProfileLinks", () => {
  afterEach(cleanup);

  it("opens only web addresses without credentials, in a new tab, and shows every other address as text", () => {
    const links = [
      { title: "Website", url: "https://bitcoin.org/" },
      { title: "Blog", url: "http://example.com/blog" },
      { title: "Pubky", url: `pubky://${KEY}` },
      { title: "Email", url: "mailto:satoshi@example.com" },
      { title: "Script", url: "javascript:alert(1)" },
      { title: "Data", url: "data:text/html,<script>alert(1)</script>" },
      { title: "Login", url: "https://satoshi:secret@example.com" },
    ];
    render(<ProfileLinks links={links} />);

    const list = screen.getByRole("list", { name: "Links" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(links.length);
    const opened = within(list).getAllByRole("link");
    expect(opened.map((link) => link.getAttribute("href"))).toEqual([
      "https://bitcoin.org/",
      "http://example.com/blog",
    ]);
    for (const link of opened) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(
      screen.getByRole("link", { name: "https://bitcoin.org/ (opens in a new tab)" }),
    ).toBeVisible();
    for (const { url } of links.slice(2)) {
      const text = within(list).getByText(url);
      expect(text.closest("a")).toBeNull();
    }
  });

  it("shows nothing for a profile without links", () => {
    const { container } = render(<ProfileLinks links={[]} />);
    expect(container).toBeEmptyDOMElement();
    render(<ProfileLinks links={undefined} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
