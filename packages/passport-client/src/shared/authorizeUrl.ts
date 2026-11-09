import type { PassportEntry } from "../client/PassportClient.js";

/**
 * Passport's one entry for a request, in a pop-up or this tab: the request travels only in the
 * fragment. A same-tab request asks for the profile, and names a testnet, here; a pop-up says both
 * in its hello instead. Mainnet adds nothing, so Passports without network support still accept it.
 */
export function authorizeUrl(
  origin: string,
  request: string,
  profileRequired = false,
  network: "mainnet" | "testnet" = "mainnet",
  entry?: PassportEntry,
): string {
  return (
    `${origin}/authorize#d=${encodeURIComponent(request)}` +
    (profileRequired ? "&profile=required" : "") +
    (network === "testnet" ? "&network=testnet" : "") +
    // The screen Passport opens on; a hint for its first screen, never part of the request.
    (entry ? `&entry=${entry}` : "")
  );
}
