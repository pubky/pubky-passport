import { describe, expect, it } from "vitest";

import { PROFILE_LIMITS } from "./ProfileSpecsAdapter";
import { randomProfileName } from "./randomProfileName";

describe("randomProfileName", () => {
  it("makes Adjective-Noun-Noun names as pubky.app does", () => {
    expect(randomProfileName(() => 0)).toBe("Blue-Rabbit-Fox");
    for (let i = 0; i < 200; i++) {
      const name = randomProfileName();
      expect(name).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+$/u);
      expect(name.length).toBeGreaterThanOrEqual(PROFILE_LIMITS.nameMinLength);
      expect(name.length).toBeLessThanOrEqual(PROFILE_LIMITS.nameMaxLength);
    }
  });

  it("never repeats a noun, even when the random source does", () => {
    for (let index = 0; index < 40; index++) {
      const [, first, second] = randomProfileName((size) => index % size).split("-");
      expect(first).not.toBe(second);
    }
  });
});
