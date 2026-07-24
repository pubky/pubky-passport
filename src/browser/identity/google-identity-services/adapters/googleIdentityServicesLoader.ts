import "client-only";

import { Result } from "better-result";

import type {
  GoogleAccounts,
  GoogleIdentityServicesResult,
} from "../application/googleIdentityServices";

declare global {
  interface Window {
    google?: { accounts?: GoogleAccounts };
  }
}

const googleGisScriptUrl = "https://accounts.google.com/gsi/client";
const gisScriptLoadTimeoutMs = 10_000;
const gisLoadStateAttribute = "data-pubky-passport-load-state";
let gisScriptLoadPromise: Promise<void> | undefined;

export async function loadGoogleAccounts(
  document: Document = globalThis.document,
  timeoutMs = gisScriptLoadTimeoutMs,
): Promise<GoogleIdentityServicesResult<GoogleAccounts>> {
  const existing = globalThis.window.google?.accounts;
  if (existing) return Result.ok(existing);

  try {
    await loadGisScript(document, timeoutMs);
  } catch {
    return Result.err({ code: "google_unavailable" });
  }

  const accounts = globalThis.window.google?.accounts;
  if (!accounts) gisScriptLoadPromise = undefined;
  return accounts ? Result.ok(accounts) : Result.err({ code: "google_unavailable" });
}

function loadGisScript(document: Document, timeoutMs: number): Promise<void> {
  if (gisScriptLoadPromise) return gisScriptLoadPromise;

  const existing = document.querySelector(`script[src="${googleGisScriptUrl}"]`);
  const existingReadyState = (existing as (Element & { readyState?: string }) | null)?.readyState;
  if (existing?.getAttribute(gisLoadStateAttribute) === "loaded" || existingReadyState === "loaded" || existingReadyState === "complete") {
    return Promise.resolve();
  }

  const script = existing ?? document.createElement("script");
  if (!existing) {
    script.setAttribute("src", googleGisScriptUrl);
    script.setAttribute("async", "");
    script.setAttribute(gisLoadStateAttribute, "loading");
  }

  const loading = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const loaded = (): void => {
      script.setAttribute(gisLoadStateAttribute, "loaded");
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      script.remove();
      reject(new Error("GIS load failed"));
    };
    const timer = setTimeout(failed, Math.max(0, timeoutMs));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) document.head.append(script);
  });

  const shared = loading.finally(() => {
    if (gisScriptLoadPromise === shared) gisScriptLoadPromise = undefined;
  });
  gisScriptLoadPromise = shared;
  return shared;
}
