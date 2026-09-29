// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KeyLockSpikeView } from "./keyLockSpike";
import { encodeBase64Url } from "@/libs/encoding/base64Url";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("exposes explicit experiment controls and renders only telemetry after the probe click", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", {
    getClientCapabilities: async () => ({ "extension:prf": true }),
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  });
  render(<KeyLockSpikeView />);
  expect(screen.getByRole("heading", { name: "Key lock device spike" })).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(16);
  expect(JSON.parse(screen.getByLabelText("Spike report log").textContent!).entries).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "P — probe" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ready"));
  const report = JSON.parse(screen.getByLabelText("Spike report log").textContent!);
  expect(report.userAgent).toBe(navigator.userAgent);
  expect(report.entries).toEqual([
    expect.objectContaining({ action: "P", secure: true, platform: true }),
  ]);
  expect(screen.getByLabelText("Spike report log").textContent).not.toMatch(
    /credentialId|prfInput|results/,
  );
});

it("shows an imported credential ID before the explicit import and excludes it from the log", async () => {
  const storageKey = "pubky-passport/key-lock-spike/v0";
  const reference = {
    credentialId: "AQIDBA",
    prfInput: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    transports: ["internal"],
    createdAt: new Date().toISOString(),
  };
  render(<KeyLockSpikeView />);
  const button = screen.getByRole("button", { name: "Import diagnostic reference" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Diagnostic reference"), {
    target: { value: JSON.stringify(reference) },
  });
  expect(screen.getByText("Import will use credential ID: AQIDBA")).toBeVisible();
  expect(localStorage.getItem(storageKey)).toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(reference)));
  expect(screen.getByLabelText("Spike report log").textContent).not.toMatch(
    /AQIDBA|prfInput|credentialId/,
  );
  localStorage.removeItem(storageKey);
});

it("aborts a pending ceremony when the document freezes without bubbling", async () => {
  let signal: AbortSignal | undefined;
  const create = vi.fn((options: CredentialCreationOptions) => {
    signal = options.signal;
    return new Promise((_, reject) =>
      signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError"))),
    );
  });
  vi.stubGlobal("navigator", {
    userAgent: navigator.userAgent,
    maxTouchPoints: 0,
    credentials: { create },
  });
  render(<KeyLockSpikeView />);
  fireEvent.click(screen.getByRole("button", { name: "C — create" }));
  expect(create).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event("freeze", { bubbles: false }));
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ready"));
});
