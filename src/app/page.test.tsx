import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the replacement UI placeholder", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain("Pubky Passport");
    expect(markup).toContain("under construction");
  });
});
