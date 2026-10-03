/**
 * Passport's one entry for a request, in a pop-up or this tab: the request travels only in the
 * fragment. A same-tab request asks for the profile here; a pop-up asks in its hello instead.
 */
export function authorizeUrl(origin: string, request: string, profileRequired = false): string {
  return (
    `${origin}/authorize#d=${encodeURIComponent(request)}` +
    (profileRequired ? "&profile=required" : "")
  );
}
