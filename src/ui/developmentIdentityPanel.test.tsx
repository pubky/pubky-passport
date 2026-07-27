/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type {
  BrowserIdentityActionResult,
  BrowserIdentityController,
  BrowserIdentityList,
} from "../browser/identity/browserIdentityController";
import { fakeBrowserIdentityController } from "../../test-utils/fakes/fakeBrowserIdentityController";
import { DevelopmentIdentityPanel } from "./developmentIdentityPanel";

const flowState = vi.hoisted(() => ({
  establish: async (): Promise<BrowserIdentityActionResult> => { throw new Error("establish result not configured"); },
  deleteExpectedPublicKey: null as string | null,
  refresh: null as (() => void) | null,
  setCatalog: null as ((catalog: BrowserIdentityList) => void) | null,
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

const selectedCatalog: BrowserIdentityList = {
  activeIdentityId: "selected-identity",
  identities: [{
    id: "selected-identity",
    publicIdentity: { publicKeyZ32: "selected-identity", publicKeyDisplay: "pubkyselected-identity" },
  }],
};

describe("DevelopmentIdentityPanel", () => {
  beforeEach(() => {
    flowState.establish = async () => { throw new Error("establish result not configured"); };
    flowState.deleteExpectedPublicKey = null;
    flowState.refresh = null;
    flowState.setCatalog = null;
    flowState.controller = controllerWithCatalog();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the identity dropdown but hides destructive tools outside development", async () => {
    flowState.controller = controllerWithCatalog(selectedCatalog);
    render(<DevelopmentIdentityPanel allowGoogleDriveReset={false} googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    expect(screen.getByRole("combobox", { name: "Selected identity" }).getAttribute("autocomplete")).toBe("off");
    expect(await screen.findByRole("option", { name: "pubkyselected-identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete identity from Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear local identities" })).not.toBeInTheDocument();
  });

  it("shows selected-identity deletion and local clear in development", async () => {
    flowState.controller = controllerWithCatalog(selectedCatalog);
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    expect(await screen.findByRole("button", { name: "Delete identity from Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear local identities" })).toBeInTheDocument();
  });

  it("keeps failed and selected Drive deletion as separate exact targets", async () => {
    flowState.controller = controllerWithCatalog(selectedCatalog);
    flowState.establish = async () => Result.err({
      code: "signup_failed",
      recoverablePublicIdentity: {
        publicKeyZ32: "failed-drive-identity",
        publicKeyDisplay: "pubkyfailed-drive-identity",
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    expect(await screen.findByRole("button", { name: "Add identity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    expect(await screen.findByRole("button", { name: "Delete failed identity from Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete identity from Google" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete failed identity from Google" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(flowState.deleteExpectedPublicKey).toBe("failed-drive-identity"));
  });

  it("keeps the confirmed Drive deletion target across external catalog refreshes", async () => {
    flowState.controller = controllerWithCatalog(selectedCatalog);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);
    expect(await screen.findByRole("button", { name: "Delete identity from Google" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete identity from Google" }));
    flowState.setCatalog?.({
      activeIdentityId: "other-identity",
      identities: [{
        id: "other-identity",
        publicIdentity: { publicKeyZ32: "other-identity", publicKeyDisplay: "pubkyother-identity" },
      }],
    });
    act(() => flowState.refresh?.());
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    await waitFor(() => expect(flowState.deleteExpectedPublicKey).toBe("selected-identity"));
  });

  it("does not offer Drive cleanup when invitation retrieval fails before creation", async () => {
    flowState.establish = async () => Result.err({ code: "homegate_unavailable" });
    render(<DevelopmentIdentityPanel allowGoogleDriveReset googleClientId="google-client" homegateBaseUrl={homegateBaseUrl} />);

    expect(await screen.findByRole("button", { name: "Add identity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorize test Google" }));

    expect(await screen.findByText(/Passport did not create an identity/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete failed identity from Google" })).not.toBeInTheDocument();
  });
});

const homegateBaseUrl = "https://homegate.example/";

function controllerWithCatalog(
  initialCatalog: BrowserIdentityList = { activeIdentityId: null, identities: [] },
): BrowserIdentityController {
  let catalog = initialCatalog;
  flowState.setCatalog = (nextCatalog) => { catalog = nextCatalog; };

  return fakeBrowserIdentityController({
    list: () => Result.ok(catalog),
    select: (id: string) => {
      catalog = {
        activeIdentityId: id,
        identities: catalog.identities,
      };
      return Result.ok();
    },
    clear: () => {
      catalog = { activeIdentityId: null, identities: [] };
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
  });
}
