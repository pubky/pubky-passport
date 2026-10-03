"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { AUTHORIZATION_ENTRY_PATH } from "@/libs/authorization/authorizationLocationRules";
import { pendingRequestPresence } from "@/client/logic/authorization/flow/pendingRequestPresence";

/**
 * Whether an app's sign-in request waits on this page, for the chrome around the screen (the
 * footer's legal links, the logo), which must not navigate the page away meanwhile. Until the
 * page's authorization controller exists (the server render and hydration), the request entry
 * path stands in for it.
 */
export function usePendingRequest(): boolean {
  const onRequestEntry = usePathname() === AUTHORIZATION_ENTRY_PATH;
  const pending = useSyncExternalStore(
    pendingRequestPresence.subscribe,
    pendingRequestPresence.read,
    () => undefined,
  );
  return pending ?? onRequestEntry;
}
