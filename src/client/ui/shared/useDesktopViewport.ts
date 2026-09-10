import { useSyncExternalStore } from "react";

/** Matches Tailwind's `md` breakpoint. */
const DESKTOP_VIEWPORT_QUERY = "(min-width: 48rem)";

/** Reports whether the viewport is at least the `md` breakpoint; `true` where `matchMedia` is unavailable. */
function useDesktopViewport(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopViewport,
    getDesktopViewport,
    getServerDesktopViewport,
  );
}

function subscribeToDesktopViewport(onChange: () => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => undefined;
  const query = globalThis.matchMedia(DESKTOP_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getDesktopViewport(): boolean {
  return (
    typeof globalThis.matchMedia !== "function" ||
    globalThis.matchMedia(DESKTOP_VIEWPORT_QUERY).matches
  );
}

function getServerDesktopViewport(): boolean {
  return true;
}

export { DESKTOP_VIEWPORT_QUERY, useDesktopViewport };
