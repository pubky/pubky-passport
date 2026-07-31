/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../libs/logger/logger";
import { GoogleIdentityServices, type GoogleAccounts } from "./googleIdentityServices";

describe("GoogleIdentityServices", () => {
  afterEach(() => {
    delete window.google;
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
    vi.useRealTimers();
  });

  it("shares one pending script load across instances and cleans up its listeners", async () => {
    const first = new GoogleIdentityServices({ document, timeoutMs: 100 }).loadGoogleAccounts();
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).toBeInstanceOf(HTMLScriptElement);
    const removeEventListener = vi.spyOn(script as HTMLScriptElement, "removeEventListener");
    const second = new GoogleIdentityServices({ document, timeoutMs: 100 }).loadGoogleAccounts();
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

    const resultPromise = new GoogleIdentityServices({ document, timeoutMs: 100 }).loadGoogleAccounts();
    window.google = { accounts: googleAccounts() };
    script.dispatchEvent(new Event("load"));

    expect(Result.isError(await resultPromise)).toBe(false);
    expect(document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')).toHaveLength(1);
  });

  it("bounds a failed load and permits a retry", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const googleIdentityServices = new GoogleIdentityServices({ document, timeoutMs: 20 });
    const failedPromise = googleIdentityServices.loadGoogleAccounts();
    await vi.advanceTimersByTimeAsync(20);
    expect(Result.isError(await failedPromise)).toBe(true);
    expect(warn).toHaveBeenCalledWith("identity.google.services.unavailable", {
      operation: "load_google_accounts",
      stage: "script_load",
      code: "script_load_failed",
    });
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();

    const retried = googleIdentityServices.loadGoogleAccounts();
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    window.google = { accounts: googleAccounts() };
    script?.dispatchEvent(new Event("load"));
    expect(Result.isError(await retried)).toBe(false);
  });

  it("logs when the loaded script does not expose Google accounts", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const resultPromise = new GoogleIdentityServices({ document, timeoutMs: 100 }).loadGoogleAccounts();
    document.querySelector('script[src="https://accounts.google.com/gsi/client"]')?.dispatchEvent(new Event("load"));

    expect(Result.isError(await resultPromise)).toBe(true);
    expect(warn).toHaveBeenCalledWith("identity.google.services.unavailable", {
      operation: "load_google_accounts",
      stage: "accounts_read",
      code: "accounts_missing",
    });
  });
});

function googleAccounts(): GoogleAccounts {
  return {
    id: { initialize: vi.fn(), renderButton: vi.fn() },
    oauth2: { initTokenClient: vi.fn() },
  };
}
