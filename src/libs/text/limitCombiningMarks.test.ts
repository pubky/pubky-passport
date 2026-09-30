import { describe, expect, it } from "vitest";

import { limitCombiningMarks, MAXIMUM_SHOWN_COMBINING_MARKS } from "./limitCombiningMarks";

describe("limitCombiningMarks", () => {
  it("cuts a long stack of marks on one character to the shown maximum", () => {
    const shown = limitCombiningMarks(`Acme${"̲".repeat(100)} Notes`);

    expect(shown).toBe(`Acme${"̲".repeat(MAXIMUM_SHOWN_COMBINING_MARKS)} Notes`);
  });

  it("cuts every stack, enclosing marks included, in paths as in labels", () => {
    expect(limitCombiningMarks(`/pub/a${"́".repeat(9)}/b${"⃝".repeat(5)}/`)).toBe(
      `/pub/a${"́".repeat(3)}/b${"⃝".repeat(3)}/`,
    );
  });

  it.each(["Café", "café", "Tiếng Việt", "Pubky App", "שָׁ֑"])(
    "keeps ordinary text as it is: %s",
    (text) => {
      expect(limitCombiningMarks(text)).toBe(text);
    },
  );
});
