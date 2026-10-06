import { useEffect, useState, useSyncExternalStore } from "react";

import {
  COARSE_POINTER_QUERY,
  DeepLinkLauncher,
  ringHandoffMode,
  type DeepLinkLaunchState,
  type RingHandoffMode,
} from "@/client/logic/universal-signer/deepLinkLauncher";

function subscribeToPointer(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether a Pubky Ring hand-off on this device opens the deep link (`open`, a coarse pointer) or
 * shows the QR code (`scan`, a fine pointer). The pointer decides, not the width: apps open
 * Passport in a narrow popup on computers, which cannot open a Ring link.
 */
export function useRingHandoffMode(): RingHandoffMode {
  return useSyncExternalStore(
    subscribeToPointer,
    () => ringHandoffMode(window),
    () => "scan",
  );
}

/**
 * The same, but unknown until the page runs in the browser: for what must not start on a guess,
 * such as a request that only a computer prepares by itself.
 */
export function useKnownRingHandoffMode(): RingHandoffMode | undefined {
  return useSyncExternalStore(
    subscribeToPointer,
    () => ringHandoffMode(window),
    () => undefined,
  );
}

const IDLE = (): DeepLinkLaunchState => "idle";

/**
 * The launch state of `shared`, a launcher that may have followed the deep link before this
 * screen opened, or of a launcher owned by the calling screen.
 */
export function useDeepLinkLauncher(
  shared?: DeepLinkLauncher | undefined,
): readonly [DeepLinkLaunchState, DeepLinkLauncher | undefined] {
  const [own] = useState(() =>
    shared || typeof window === "undefined" ? undefined : new DeepLinkLauncher(window),
  );
  useEffect(() => (own ? () => own.dispose() : undefined), [own]);
  const launcher = shared ?? own;
  const state = useSyncExternalStore(
    launcher?.subscribe ?? subscribeToNothing,
    launcher?.getState ?? IDLE,
    IDLE,
  );
  return [state, launcher] as const;
}

function subscribeToNothing(): () => void {
  return () => undefined;
}
