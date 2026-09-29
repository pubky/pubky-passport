import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { RequestExitAction, useOpenedByApp } from "./requestExit";

/**
 * Shown when the browser restores a page from its back/forward cache after it was left while a
 * request waited: the request was released on leaving, so no action here could answer the app.
 * A popup closes itself; a tab goes to Passport's start page.
 */
export function RequestClosed() {
  const inPopup = useOpenedByApp();
  return (
    <ErrorScreen
      accent="closed."
      action={<RequestExitAction inPopup={inPopup} />}
      cause="This page was left while the app waited, so the request it opened with has ended."
      nextStep="Start signing in again in the app."
      title="Sign-in request"
    />
  );
}
