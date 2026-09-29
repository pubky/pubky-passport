import { useState } from "react";

import { ArrowRightIcon, XIcon } from "@/client/ui/shared/icons";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * Shown when the browser restores a page from its back/forward cache after it was left while a
 * request waited: the request was released on leaving, so no action here could answer the app.
 * A popup closes itself; a tab goes to Passport's start page.
 */
export function RequestClosed() {
  const [inPopup] = useState(() => {
    try {
      return window.opener !== null && window.opener !== undefined;
    } catch {
      return false;
    }
  });
  return (
    <ErrorScreen
      accent="closed."
      action={
        inPopup ? (
          <Button className="w-full" onClick={() => window.close()} size="lg">
            <XIcon />
            Close window
          </Button>
        ) : (
          <Button className="w-full" onClick={() => window.location.replace("/")} size="lg">
            <ArrowRightIcon />
            Go to Passport
          </Button>
        )
      }
      cause="This page was left while the app waited, so the request it opened with has ended."
      nextStep="Start signing in again in the app."
      title="Sign-in request"
    />
  );
}
