import type { AttemptEvent } from "../attempt/attemptModel.js";
import { chooseBlockedPopupRoute, chooseSignInRoute } from "../attempt/chooseSignInRoute.js";
import type { BrowserEnvironment } from "../environment/browserEnvironment.js";
import { openPassportPopup } from "../popup/openPassportPopup.js";
import type { PopupPort, PopupRequest } from "../popup/PopupPort.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";

interface SignInPopupResult {
  event: Extract<AttemptEvent, { type: "SIGN_IN" }>;
  diagnostic?: PassportDiagnostic;
}

/** The caller claims the result before notifying app observers of its diagnostic. */
export function openSignInPopup(
  popup: PopupPort,
  request: PopupRequest,
  environment: BrowserEnvironment,
): SignInPopupResult {
  const event = { type: "SIGN_IN", instance: request.instance } as const;
  const route = chooseSignInRoute(environment);
  if (route.kind !== "popup") return { event: { ...event, route } };
  const opened = openPassportPopup(popup, request, environment.userActivation);
  return {
    event:
      opened.kind === "blocked"
        ? { ...event, route: chooseBlockedPopupRoute(environment) }
        : { ...event, popup: opened.kind === "live" ? opened.popup : undefined },
    ...(opened.diagnostic ? { diagnostic: opened.diagnostic } : {}),
  };
}
