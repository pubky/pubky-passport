/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { DevelopmentIdentityPanel } from "./developmentIdentityPanel";

const flowState = vi.hoisted(() => ({
  establish: async (): Promise<unknown> => { throw new Error("establish result not configured"); },
  deleteExpectedPublicKey: null as string | null,
  refresh: null as (() => void) | null,
  controller: null as unknown,
}));

vi.mock("../browser/identity/createBrowserIdentityController", () => ({
  createBrowserIdentityController: () => flowState.controller,
}));

vi.mock("./googleSignInButton", () => ({
  GoogleSignInButton: ({ action, controller, onActionCompleted }: {
    action: { kind: "establish" } | { kind: "delete"; expectedPublicKeyZ32: string };
    controller: { continueGoogle(action: unknown): Promise<{ status: string; result?: unknown }> };
    onActionCompleted: (result: unknown) => void;
  }) => <button onClick={() => void controller.continueGoogle(action).then((completed) => {
    if (completed.status === "action_completed") onActionCompleted(completed.result);
  })} type="button">Authorize test Google</button>,
}));

const storedIdentity = {
  v: 1,
  activeIdentityId: "selected-identity",
  identities: [{
    id: "selected-identity",
    publicIdentity: { publicKeyZ32: "selected-identity", publicKeyDisplay: "pubkyselected-identity" },
    secretKey: "a".repeat(43),
  }],
};

describe("DevelopmentIdentityPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    flowState.establish = async () => { throw new Error("establish result not configured"); };
    flowState.deleteExpectedPublicKey = null;
    flowState.refresh = null;
    flowState.controller = controllerForLocalStorage();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the identity dropdown but hides destructive tools outside development", async () => {
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify(storedIdentity));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset={false} googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    expect(screen.getByRole("combobox", { name: "Selected identity" }).getAttribute("autocomplete")).toBe("off");
    await waitFor(() => expect(screen.getByRole("option", { name: "pubkyselected-identity" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Add identity" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Delete identity from Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear local identities" })).toBeNull();
  });

  it("shows selected-identity deletion and local clear in development", async () => {
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify(storedIdentity));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete identity from Google" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Clear local identities" })).toBeDefined();
  });

  it("keeps failed and selected Drive deletion as separate exact targets", async () => {
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify(storedIdentity));
    flowState.establish = async () => Result.err({
      code: "signup_failed",
      recoverablePublicIdentity: {
        publicKeyZ32: "failed-drive-identity",
        publicKeyDisplay: "pubkyfailed-drive-identity",
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add identity" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Add identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete failed identity from Google" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Delete identity from Google" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete failed identity from Google" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(flowState.deleteExpectedPublicKey).toBe("failed-drive-identity"));
  });

  it("keeps the confirmed Drive deletion target across external catalog refreshes", async () => {
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify(storedIdentity));
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete identity from Google" })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Delete identity from Google" }));
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activeIdentityId: "other-identity",
      identities: [{
        id: "other-identity",
        publicIdentity: { publicKeyZ32: "other-identity", publicKeyDisplay: "pubkyother-identity" },
        secretKey: "b".repeat(43),
      }],
    }));
    act(() => flowState.refresh?.());
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(flowState.deleteExpectedPublicKey).toBe("selected-identity"));
  });

  it("does not offer Drive cleanup when invitation retrieval fails before creation", async () => {
    flowState.establish = async () => Result.err({ code: "homegate_unavailable" });
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add identity" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Add identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(screen.getByText(/Passport did not create an identity/)).toBeDefined());
    expect(screen.queryByRole("button", { name: "Delete failed identity from Google" })).toBeNull();
  });
});

const homegateBaseUrl = "https://homegate.example/";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.#values.keys())[index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

function controllerForLocalStorage() {
  return {
    list: () => listStoredIdentities(),
    select: (id: string) => {
      const stored = listStoredIdentities();
      if (Result.isError(stored)) return stored;
      localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
        v: 1,
        activeIdentityId: id,
        identities: JSON.parse(localStorage.getItem("pubky-passport/local-identities/v1") ?? "{}").identities ?? [],
      }));
      return Result.ok();
    },
    clear: () => {
      localStorage.removeItem("pubky-passport/local-identities/v1");
      return Result.ok();
    },
    subscribe: (listener: () => void) => {
      flowState.refresh = listener;
      return () => { flowState.refresh = null; };
    },
    continueGoogle: async (action: { kind: "establish" } | { kind: "delete"; expectedPublicKeyZ32: string }) => {
      if (action.kind === "establish") {
        return { status: "action_completed", result: await flowState.establish() };
      }
      flowState.deleteExpectedPublicKey = action.expectedPublicKeyZ32;
      return { status: "action_completed", result: Result.ok({ kind: "deleted" }) };
    },
    mountGoogleSignIn: async () => {},
    unmountGoogleSignIn: () => {},
    retryGoogleSignIn: () => {},
    dispose: () => {},
  };
}

function listStoredIdentities() {
  const raw = localStorage.getItem("pubky-passport/local-identities/v1");
  if (!raw) return Result.ok({ activeIdentityId: null, identities: [] });
  const value = JSON.parse(raw);
  return Result.ok({
    activeIdentityId: value.activeIdentityId,
    identities: value.identities.map((identity: { id: string; publicIdentity: unknown }) => ({
      id: identity.id,
      publicIdentity: identity.publicIdentity,
    })),
  });
}
