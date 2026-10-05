/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { markAuthorizeFromIdentity, takeAuthorizeFromIdentity } from "./authorizeFromIdentity";

describe("the identity Authorize was pressed on", () => {
  it("is kept for the next page load and read once", () => {
    const storage = new MemoryStorage();
    expect(takeAuthorizeFromIdentity(storage)).toBeUndefined();

    markAuthorizeFromIdentity("identity", storage);
    expect(takeAuthorizeFromIdentity(storage)).toBe("identity");
    expect(takeAuthorizeFromIdentity(storage)).toBeUndefined();
    expect(storage.length).toBe(0);
  });

  it("is simply absent when even naming the tab's storage throws", () => {
    // A browser that blocks site data throws on the property itself, not on its methods.
    const blocked = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      expect(() => markAuthorizeFromIdentity("identity")).not.toThrow();
      expect(takeAuthorizeFromIdentity()).toBeUndefined();
    } finally {
      blocked.mockRestore();
    }
  });

  it("is simply absent when the browser blocks session storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(() => markAuthorizeFromIdentity("identity", blocked)).not.toThrow();
    expect(takeAuthorizeFromIdentity(blocked)).toBeUndefined();
  });
});
