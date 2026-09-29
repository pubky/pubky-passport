/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar } from "./avatar";

const KEY = "6mfxozzqmb36rc9rgy3rykoyfghfao74n8igt5tf1boehproahoy";

describe("Avatar", () => {
  afterEach(cleanup);

  it("gives a pubky without a picture pubky.app's face for its key", () => {
    const { container } = render(<Avatar profileName="Satoshi" publicKey={KEY} />);

    expect(container.querySelector("[data-facehash]")).toHaveTextContent(/^S$/u);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the picture, and the face once the picture cannot be drawn", () => {
    const { container } = render(<Avatar publicKey={KEY} src="blob:avatar" />);

    const picture = container.querySelector("img")!;
    expect(picture).toHaveAttribute("src", "blob:avatar");
    expect(container.querySelector("[data-facehash]")).toBeNull();
    fireEvent.error(picture);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-facehash]")).toHaveTextContent(/^6$/u);
  });

  it("tries a new picture after one failed", () => {
    const { container, rerender } = render(<Avatar publicKey={KEY} src="blob:broken" />);
    fireEvent.error(container.querySelector("img")!);

    rerender(<Avatar publicKey={KEY} src="blob:avatar" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:avatar");
  });

  it("stands in for a name that is not a pubky with its initials", () => {
    const { container } = render(<Avatar fallback="satoshi nakamoto" />);

    expect(container).toHaveTextContent(/^SA$/u);
    expect(container.querySelector("[data-facehash]")).toBeNull();
  });
});
