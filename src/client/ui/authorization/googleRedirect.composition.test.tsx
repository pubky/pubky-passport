/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { readAndScrubAuthorizationEntry } from "@/client/logic/authorization/entry/authorizationEntry";
import { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import type { GoogleIdentityLifecycle } from "@/client/logic/google-identity/GoogleIdentityLifecycle";
import { GoogleRedirectAuthorization } from "@/client/logic/google-identity/gia/GoogleRedirectAuthorization";
import {
  resumeGoogleRedirect,
  setGoogleRedirectRequest,
} from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import {
  EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY,
  GOOGLE_REDIRECT_STORAGE_KEY,
} from "@/libs/authorization/googleRedirectConstants";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "@/libs/authorization/earlyGoogleImplicitResponse";
import { AuthorizationFlow } from "./authorizationFlow";

const REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";
const STATE = "s".repeat(43);
const NONCE = "n".repeat(43);
const RESTORED = {
  publicIdentity: { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" },
  googleAccount: {
    googleSubject: "restored-google-user",
    email: "restored@example.com",
    name: "Restored User",
    pictureUrl: null,
  },
};
const PREVIOUS = {
  publicIdentity: { publicKeyZ32: "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo" },
  googleAccount: {
    googleSubject: "previous-google-user",
    email: "previous@example.com",
    name: "Previous User",
    pictureUrl: null,
  },
};

describe("successful Google redirect through capability review", () => {
  afterEach(() => {
    cleanup();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    setGoogleRedirectRequest({ status: "empty" }, window);
    Reflect.deleteProperty(window, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it.each([
    { hasPreviousIdentity: false, mode: "restored" },
    { hasPreviousIdentity: true, mode: "restored" },
    { hasPreviousIdentity: false, mode: "created" },
  ] as const)(
    "reviews a $mode Google identity (previous identity: $hasPreviousIdentity)",
    async ({ hasPreviousIdentity, mode }) => {
      const browserWindow = window;
      const navigate = vi.fn();
      // Navigation is the browser boundary. Everything through UI, response validation,
      // controller continuation, and request re-parsing uses the production code.
      const appWindow = new Proxy(browserWindow, {
        get(target, property) {
          if (property === "location")
            return Object.assign(new URL(browserWindow.location.href), { replace: navigate });
          return Reflect.get(target, property, target) as unknown;
        },
      });
      vi.stubGlobal("window", appWindow);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              sub: RESTORED.googleAccount.googleSubject,
              email: RESTORED.googleAccount.email,
              name: RESTORED.googleAccount.name,
            }),
          ),
        ),
      );
      const open = vi.spyOn(browserWindow, "open");
      browserWindow.sessionStorage.setItem(
        GOOGLE_REDIRECT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          requestUrl: REQUEST,
          state: STATE,
          nonce: NONCE,
          expiresAt: Date.now() + 60_000,
          operation: "establish",
          allowWithoutVisibleBackup: false,
        }),
      );
      Object.defineProperty(browserWindow, EARLY_GOOGLE_REDIRECT_RESPONSE_PROPERTY, {
        configurable: true,
        value: () => ({
          type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
          status: "captured",
          hash: `#${new URLSearchParams({
            state: STATE,
            access_token: "google-access-canary",
            id_token: `header.${btoa(JSON.stringify({ sub: RESTORED.googleAccount.googleSubject, nonce: NONCE }))}.signature`,
            scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
            expires_in: "3600",
          })}`,
        }),
      });
      const entry = resumeGoogleRedirect(browserWindow);
      if (!entry || entry.status !== "valid") throw new Error("Expected a valid return");
      let authorization = new PassportAuthorizationController(appWindow, entry);
      const catalogState: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined } = {
        catalog: {
          identities: hasPreviousIdentity ? [PREVIOUS] : [],
          activePublicKeyZ32: hasPreviousIdentity ? PREVIOUS.publicIdentity.publicKeyZ32 : null,
        },
      };
      let finishRestore!: () => void;
      const establishIdentity = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<GoogleIdentityLifecycle["establishIdentity"]>>>(
            (resolve) => {
              finishRestore = () => {
                catalogState.catalog = {
                  identities: [...catalogState.catalog.identities, RESTORED],
                  activePublicKeyZ32: RESTORED.publicIdentity.publicKeyZ32,
                };
                catalogState.listener?.();
                resolve(
                  Result.ok({
                    establishmentMode: mode,
                    publicIdentity: RESTORED.publicIdentity,
                    visibleRecoveryCopyStatus: "skipped",
                  }),
                );
              };
            },
          ),
      );
      const createGoogleIdentityController = vi.fn(
        (clientId: string, homegate: string, forAuthorization?: boolean) => {
          expect(forAuthorization).toBe(true);
          return new GoogleIdentityController(
            clientId,
            homegate,
            () => ({ request: vi.fn(), dispose: vi.fn() }),
            () => ({
              establishIdentity,
              abortRequests: vi.fn(),
              dispose: vi.fn(),
              detachIdentity: vi.fn(),
              replaceInvalidPassportFile: vi.fn(),
              replaceUndecryptablePassportFile: vi.fn(),
            }),
            new GoogleRedirectAuthorization(clientId, appWindow),
          );
        },
      );
      const renderFlow = () =>
        render(
          withPassportTestProviders(
            <StrictMode>
              <AuthorizationFlow />
            </StrictMode>,
            {
              createAuthorizationController: () => authorization,
              createGoogleIdentityController,
              createLocalIdentityController: () => fakeLocalIdentityController(catalogState),
            },
          ),
        );
      renderFlow();
      await waitFor(() => expect(establishIdentity).toHaveBeenCalledOnce());
      expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
      expect(screen.queryByText("Previous User")).not.toBeInTheDocument();
      await act(async () => finishRestore());
      if (mode === "created") {
        expect(navigate).not.toHaveBeenCalled();
        await userEvent.setup().click(await screen.findByRole("button", { name: "Continue" }));
      }
      await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
      expect(navigate).toHaveBeenCalledWith(`/authorize#d=${encodeURIComponent(REQUEST)}`);
      expect(open).not.toHaveBeenCalled();
      expect(browserWindow.sessionStorage.getItem(GOOGLE_REDIRECT_STORAGE_KEY)).toBeNull();

      // Complete the navigation the browser would perform and verify its actual review UI.
      cleanup();
      browserWindow.dispatchEvent(new PageTransitionEvent("pagehide"));
      browserWindow.history.replaceState(null, "", navigate.mock.calls[0]![0] as string);
      const reviewEntry = readAndScrubAuthorizationEntry(browserWindow);
      setGoogleRedirectRequest(reviewEntry, browserWindow);
      authorization = new PassportAuthorizationController(appWindow, reviewEntry);
      renderFlow();
      expect(
        await screen.findByRole("heading", { name: "Sign in to client.example" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Restored User")).toBeInTheDocument();
      expect(screen.getByText("/pub/example.app/", { exact: true })).toBeInTheDocument();
      expect(createGoogleIdentityController).toHaveBeenCalledOnce();
      expect(browserWindow.location.hash).toBe("");
      await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(navigate).toHaveBeenLastCalledWith("https://client.example/cancel"),
      );
    },
  );
});
