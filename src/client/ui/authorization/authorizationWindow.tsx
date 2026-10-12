"use client";

import { useEffect, type ReactNode } from "react";

/** Browsers decide whether a script-opened window can be resized. */
function AuthorizationWindow({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!window.opener) return;
    const width = Math.min(390, window.screen.availWidth || 390);
    const height = Math.min(800, window.screen.availHeight || 800);
    try {
      window.resizeTo(width, height);
    } catch {
      // Mobile browsers and ordinary tabs can refuse resizing; the layout still fits.
    }
  }, []);

  return children;
}

export { AuthorizationWindow };
