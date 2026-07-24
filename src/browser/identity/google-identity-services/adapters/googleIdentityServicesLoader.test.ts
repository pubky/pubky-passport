/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleAccounts } from "../application/googleIdentityServices";
import { loadGoogleAccounts } from "./googleIdentityServicesLoader";

describe("loadGoogleAccounts", () => {
  afterEach(() => {
    delete window.google;
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
    vi.useRealTimers();
  });

  it("shares one pending script load and cleans up its listeners", async () => {
    const first = loadGoogleAccounts(document, 100);
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).toBeInstanceOf(HTMLScriptElement);
    const removeEventListener = vi.spyOn(script as HTMLScriptElement, "removeEventListener");
    const second = loadGoogleAccounts(document, 100);
    window.google = { accounts: googleAccounts() };
    script?.dispatchEvent(new Event("load"));

    expect(Result.isError(await first)).toBe(false);
    expect(Result.isError(await second)).toBe(false);
    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
    expect(removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("observes an already-present loading script", async () => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    document.head.append(script);

    const resultPromise = loadGoogleAccounts(document, 100);
    window.google = { accounts: googleAccounts() };
    script.dispatchEvent(new Event("load"));

    expect(Result.isError(await resultPromise)).toBe(false);
    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
  });

  it("bounds a failed load and permits a retry", async () => {
    vi.useFakeTimers();
    const failedPromise = loadGoogleAccounts(document, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(Result.isError(await failedPromise)).toBe(true);
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();

    const retried = loadGoogleAccounts(document, 20);
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    window.google = { accounts: googleAccounts() };
    script?.dispatchEvent(new Event("load"));
    expect(Result.isError(await retried)).toBe(false);
  });
});

function googleAccounts(): GoogleAccounts {
  return {
    id: { initialize: vi.fn(), renderButton: vi.fn() },
    oauth2: { initTokenClient: vi.fn() },
  };
}
