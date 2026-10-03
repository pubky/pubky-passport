/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DetailField } from "./detailField";

const PUBKY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

describe("DetailField", () => {
  afterEach(cleanup);

  it("sets a value in one size with or without its copy button", () => {
    render(
      <>
        <DetailField
          copy={{
            copied: "Pubky copied",
            failed: "Could not copy pubky",
            failedDescription: "Select and copy your pubky manually.",
            value: PUBKY,
          }}
          label="Your pubky"
          value={PUBKY}
        />
        <DetailField label="Homeserver to publish" value={HOMESERVER} />
      </>,
    );

    expect(screen.getByRole("button", { name: "Copy Your pubky" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copy Homeserver to publish" })).toBeNull();
    // Two keys in one card read as a pair, not as a small one and a large one.
    const copyable = screen.getByText(PUBKY);
    const plain = screen.getByText(HOMESERVER);
    expect(copyable.className).toBe(plain.className);
    expect(plain).toHaveClass("text-sm", "leading-5", "break-all");
  });

  it("shows a status in place of the value and offers no copy while there is nothing to copy", () => {
    render(
      <DetailField
        copy={{
          copied: "Homeserver copied",
          failed: "Could not copy homeserver",
          failedDescription: "Select and copy the homeserver manually.",
          value: null,
        }}
        label="Homeserver"
        value={<span className="text-muted-foreground">Looking up…</span>}
      />,
    );

    expect(screen.getByText("Looking up…")).toHaveClass("text-muted-foreground");
    expect(screen.queryByRole("button", { name: "Copy Homeserver" })).not.toBeInTheDocument();
    // The row keeps the 36px button's height, so the content below stays put when a key arrives.
    expect(screen.getByText("Looking up…").closest(".flex")).toHaveClass("min-h-9");
  });
});
