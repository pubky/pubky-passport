"use client";

import { useSyncExternalStore } from "react";

import {
  currentKeychainAuthMethod,
  subscribeKeychainAuthMethod,
  writeKeychainAuthMethod,
  type KeychainAuthMethod,
} from "@/client/logic/pubky/keychainAuthMethod";
import { cn } from "./mergeClassNames";

/** This device's choice for Passport's own keychain requests, kept up to date across tabs. */
export function useKeychainAuthMethod(): KeychainAuthMethod {
  return useSyncExternalStore(
    subscribeKeychainAuthMethod,
    currentKeychainAuthMethod,
    () => "grant",
  );
}

/**
 * The fallback for Pubky Ring older than 2.0, which cannot approve Passport's grant requests: on,
 * the same request is made the legacy way (a cookie sign-in), and the choice is kept for this
 * device. Off by default, since Pubky Ring 2.0 and Bitkit approve grants (Bitkit refuses the
 * legacy way). Shown only where Passport makes the request itself, never on an app's request.
 * Few people need it, so it is one short, quiet line under the code; the whole line toggles it,
 * and its label is all it says.
 */
export function ClassicQrSwitch({ className }: { className?: string }) {
  const method = useKeychainAuthMethod();
  return (
    <label
      className={cn(
        "flex min-h-6 w-fit cursor-pointer items-center gap-2 text-xs leading-4 text-muted-foreground pointer-coarse:min-h-11",
        className,
      )}
    >
      <input
        checked={method === "cookie"}
        className={cn(
          "relative h-4 w-7 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-secondary transition-colors",
          "after:absolute after:top-0.5 after:left-0.5 after:size-2.5 after:rounded-full after:bg-muted-foreground after:transition-transform after:content-['']",
          "checked:border-brand checked:bg-brand/30 checked:after:translate-x-3 checked:after:bg-brand",
        )}
        onChange={() => writeKeychainAuthMethod(method === "cookie" ? "grant" : "cookie")}
        role="switch"
        type="checkbox"
      />
      Older Pubky Ring? Classic QR
    </label>
  );
}
