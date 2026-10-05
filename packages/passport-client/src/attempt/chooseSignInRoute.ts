import type { BrowserEnvironment } from "../environment/browserEnvironment.js";

export type RedirectCause = "preferred" | "blocked";
export type SignInRoute =
  | { kind: "popup" }
  | { kind: "redirect"; cause: "preferred"; diagnostic?: "cross_origin_isolated" };
export type BlockedPopupRoute =
  | { kind: "redirect"; cause: "blocked" }
  | { kind: "failed"; code: "unsupported_environment" }
  | { kind: "failed"; code: "popup_blocked"; diagnostic: "redirect_unavailable" };

/**
 * Chooses before the caller opens a window or starts asynchronous work. In-app browsers, iOS
 * home-screen apps and cross-origin-isolated pages lose a pop-up's opener, so they go to Passport
 * in this tab straight away.
 */
export function chooseSignInRoute(environment: BrowserEnvironment): SignInRoute {
  if (
    sameTabAvailable(environment) &&
    (environment.inApp || environment.iosStandalone || environment.crossOriginIsolated)
  )
    return {
      kind: "redirect",
      cause: "preferred",
      ...(environment.crossOriginIsolated
        ? ({ diagnostic: "cross_origin_isolated" } as const)
        : {}),
    };
  return { kind: "popup" };
}

/** A blocked pop-up continues in this tab whenever the page can come back to itself. */
export function chooseBlockedPopupRoute(environment: BrowserEnvironment): BlockedPopupRoute {
  if (!environment.topLevel) return { kind: "failed", code: "unsupported_environment" };
  if (!sameTabAvailable(environment))
    return { kind: "failed", code: "popup_blocked", diagnostic: "redirect_unavailable" };
  return { kind: "redirect", cause: "blocked" };
}

/** Same tab needs a top-level HTTPS page that can keep its saved state across the navigation. */
function sameTabAvailable(environment: BrowserEnvironment): boolean {
  return environment.topLevel && environment.protocol === "https:" && environment.storageWritable;
}
