/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentKeychainAuthMethod,
  KEYCHAIN_AUTH_METHOD_KEY,
  readKeychainAuthMethod,
  subscribeKeychainAuthMethod,
  writeKeychainAuthMethod,
} from "./keychainAuthMethod";

afterEach(() => {
  writeKeychainAuthMethod("grant");
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("keychainAuthMethod", () => {
  it("asks with a grant unless this device chose the classic QR", () => {
    expect(readKeychainAuthMethod()).toBe("grant");
    writeKeychainAuthMethod("cookie");
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
    expect(readKeychainAuthMethod()).toBe("cookie");
    expect(currentKeychainAuthMethod()).toBe("cookie");
    writeKeychainAuthMethod("grant");
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();
    expect(currentKeychainAuthMethod()).toBe("grant");
  });

  it("reads anything else stored as a grant", () => {
    localStorage.setItem(KEYCHAIN_AUTH_METHOD_KEY, "something");
    expect(readKeychainAuthMethod()).toBe("grant");
  });

  it("keeps the choice for this page when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    writeKeychainAuthMethod("cookie");
    expect(currentKeychainAuthMethod()).toBe("cookie");
  });

  it("tells listeners about a change here and in another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKeychainAuthMethod(listener);
    writeKeychainAuthMethod("cookie");
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: KEYCHAIN_AUTH_METHOD_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeKeychainAuthMethod("grant");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
