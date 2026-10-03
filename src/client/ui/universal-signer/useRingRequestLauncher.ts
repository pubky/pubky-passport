import { useEffect, useState } from "react";

import {
  DeepLinkLauncher,
  ringHandoffMode,
} from "@/client/logic/universal-signer/deepLinkLauncher";
import type { AuthorizationController } from "@/client/ui/authorization/usePassportAuthorization";

/**
 * Hands the page's request to Pubky Ring: `launch` runs from the person's own press, so a phone
 * follows the request's deep link then (only such a navigation lets a browser open the app), and
 * the launcher notices when Ring did not open. A computer skips the link for the QR code.
 */
export function useRingRequestLauncher(
  controller: AuthorizationController,
): readonly [launcher: DeepLinkLauncher, launch: () => void] {
  const [launcher] = useState(() => new DeepLinkLauncher(window));
  useEffect(() => () => launcher.dispose(), [launcher]);
  const launch = () => {
    launcher.reset();
    const url = ringHandoffMode(window) === "open" ? controller.externalSignerUrl() : undefined;
    if (url) launcher.launch(url);
  };
  return [launcher, launch] as const;
}
