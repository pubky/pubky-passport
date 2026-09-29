/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { takeInitialAuthorizationEntry } from "@/instrumentation-client";
import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { pendingRequestPresence } from "@/client/logic/authorization/flow/pendingRequestPresence";
import {
  resetBrowserAuthorizationStoreForTests,
  usePassportAuthorization,
} from "./usePassportAuthorization";

function Probe() {
  const { controller, state, closed } = usePassportAuthorization();
  return (
    <p>
      {closed ? "closed" : (state?.status ?? "no-state")}:
      {controller === null
        ? "none"
        : controller === PassportAuthorizationController.fromBrowser(takeInitialAuthorizationEntry)
          ? "browser"
          : "other"}
    </p>
  );
}

const REVIEW: PassportAuthorizationViewState = {
  status: "review",
  review: { authenticationMethod: "cookie", capabilities: [], callbackHost: "app.example" },
};

type FakeState = {
  current?: PassportAuthorizationViewState | undefined;
  listener?: ((state: PassportAuthorizationViewState) => void) | undefined;
};

function renderWith(state: FakeState) {
  const controller = fakePassportAuthorizationController(state);
  render(withPassportTestProviders(<Probe />, { createAuthorizationController: () => controller }));
  return controller;
}

function pageTransition(type: "pagehide" | "pageshow", persisted: boolean) {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent(type, { persisted }));
  });
}

describe("usePassportAuthorization", () => {
  afterEach(() => {
    cleanup();
    resetBrowserAuthorizationStoreForTests();
  });

  it("uses the page-scoped browser controller when no collaborators provider is rendered", async () => {
    render(<Probe />);

    expect(await screen.findByText("manual-entry:browser")).toBeInTheDocument();
  });

  it("tells the page chrome whether a request still waits for its answer", () => {
    const state: FakeState = { current: REVIEW };
    renderWith(state);
    expect(pendingRequestPresence.read()).toBe(true);

    act(() => {
      state.current = { status: "cancelled" };
      state.listener?.(state.current!);
    });
    expect(screen.getByText("cancelled:other")).toBeInTheDocument();
    expect(pendingRequestPresence.read()).toBe(false);
  });

  it("reports a request left for the back/forward cache as closed when the page returns", () => {
    const controller = renderWith({ current: REVIEW });
    expect(screen.getByText("review:other")).toBeInTheDocument();

    pageTransition("pagehide", true);
    expect(controller.dispose).toHaveBeenCalledOnce();
    expect(pendingRequestPresence.read()).toBe(false);
    pageTransition("pageshow", true);

    // Nothing on the page can answer the app any more, and no new controller takes its place.
    expect(screen.getByText("closed:none")).toBeInTheDocument();
  });

  it("does not close a page whose request already had its answer", () => {
    renderWith({ current: { status: "approved" } });

    pageTransition("pagehide", true);
    pageTransition("pageshow", true);

    expect(screen.getByText("approved:other")).toBeInTheDocument();
  });
});
