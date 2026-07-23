import "client-only";

import { Result } from "better-result";

import {
  getParserIssuedPubkyAuthCallbacks,
  parsePubkyAuthRequest,
  type PubkyAuthRequestReview,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../features/auth/parsePubkyAuthRequest";
import type { ActiveAuthorizationResult } from "./approveActiveAuthorization";
import type {
  BrowserAuthorizationController,
  BrowserAuthorizationViewState,
} from "./browserAuthorizationController";

type ParsedAuthorizationEntry =
  | { status: "valid"; review: PubkyAuthRequestReview; approval: ValidatedSensitivePubkyAuthRequest }
  | { status: "invalid" };

type PendingStrictModeEntry = {
  scrubbedHref: string;
  entry: ParsedAuthorizationEntry;
};

export type BrowserAuthorizationControllerDependencies = {
  approveAuthorization(approval: ValidatedSensitivePubkyAuthRequest): Promise<ActiveAuthorizationResult>;
  navigate(url: string): void;
};

const pendingStrictModeEntries = new WeakMap<Window, PendingStrictModeEntry>();

export function createBrowserAuthorizationControllerCore(input: {
  browserWindow: Window;
  relayOrigin: string;
  dependencies: BrowserAuthorizationControllerDependencies;
}): BrowserAuthorizationController {
  const entry = readAndScrubAuthorizationEntry(input.browserWindow, input.relayOrigin);
  return new DefaultBrowserAuthorizationController({
    browserWindow: input.browserWindow,
    entry,
    dependencies: input.dependencies,
  });
}

class DefaultBrowserAuthorizationController implements BrowserAuthorizationController {
  readonly #browserWindow: Window;
  readonly #entry: ParsedAuthorizationEntry;
  readonly #dependencies: BrowserAuthorizationControllerDependencies;
  readonly #listeners = new Set<(state: BrowserAuthorizationViewState) => void>();
  #state: BrowserAuthorizationViewState;
  #approvalPending = false;

  constructor(input: {
    browserWindow: Window;
    entry: ParsedAuthorizationEntry;
    dependencies: BrowserAuthorizationControllerDependencies;
  }) {
    this.#browserWindow = input.browserWindow;
    this.#entry = input.entry;
    this.#dependencies = input.dependencies;
    this.#state = input.entry.status === "valid"
      ? { status: "review", review: input.entry.review }
      : { status: "invalid" };
  }

  getState(): BrowserAuthorizationViewState {
    return this.#state;
  }

  subscribe(listener: (state: BrowserAuthorizationViewState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  mounted(): void {
    pendingStrictModeEntries.delete(this.#browserWindow);
  }

  async approve(): Promise<BrowserAuthorizationViewState> {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    this.#approvalPending = true;
    this.update({ status: "approving", review: this.#entry.review });
    let result: ActiveAuthorizationResult;
    try {
      result = await this.#dependencies.approveAuthorization(this.#entry.approval);
    } catch {
      result = Result.err({ code: "approval_failed" });
    }

    try {
      if (Result.isOk(result)) {
        const success = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.success;
        if (success && this.tryNavigate(success)) {
          return this.update({ status: "redirecting", review: this.#entry.review });
        }
        return this.update({ status: "approved" });
      }

      const errorCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.error;
      if (errorCallback && this.tryNavigate(errorCallback)) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
      return this.update({ status: "failed", failureCode: result.error.code });
    } catch {
      return this.update({ status: "failed", failureCode: "approval_failed" });
    }
  }

  cancel(): BrowserAuthorizationViewState {
    if (this.#entry.status !== "valid" || this.#approvalPending || this.#state.status !== "review") {
      return this.#state;
    }

    try {
      const cancelCallback = getParserIssuedPubkyAuthCallbacks(this.#entry.approval)?.cancel;
      if (cancelCallback && this.tryNavigate(cancelCallback)) {
        return this.update({ status: "redirecting", review: this.#entry.review });
      }
    } catch {
      // Callback retrieval and navigation failures always terminate locally.
    }
    return this.update({ status: "cancelled" });
  }

  private tryNavigate(url: string): boolean {
    try {
      this.#dependencies.navigate(url);
      return true;
    } catch {
      return false;
    }
  }

  private update(state: BrowserAuthorizationViewState): BrowserAuthorizationViewState {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // Rendering consumers cannot make controller intents reject or throw.
      }
    }
    return state;
  }
}

function readAndScrubAuthorizationEntry(
  browserWindow: Window,
  relayOrigin: string,
): ParsedAuthorizationEntry {
  const rawSearch = browserWindow.location.search;
  const scrubbedHref = `${browserWindow.location.origin}${browserWindow.location.pathname}${browserWindow.location.hash}`;
  // Avoid framework-patched history methods during render while scrubbing before commit.
  const HistoryConstructor = (browserWindow as Window & { History: typeof History }).History;
  HistoryConstructor.prototype.replaceState.call(
    browserWindow.history,
    null,
    "",
    `${browserWindow.location.pathname}${browserWindow.location.hash}`,
  );

  if (rawSearch.length === 0) {
    const pending = pendingStrictModeEntries.get(browserWindow);
    if (pending?.scrubbedHref === scrubbedHref) {
      pendingStrictModeEntries.delete(browserWindow);
      return pending.entry;
    }
  }

  const rawD = extractRawDQueryValue(rawSearch);
  const parsed = parsePubkyAuthRequest(rawD.valid ? rawD.value : undefined, {
    allowedRelayOrigins: [relayOrigin],
  });
  const entry: ParsedAuthorizationEntry = Result.isError(parsed)
    ? { status: "invalid" }
    : { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
  const pending = { scrubbedHref, entry };
  pendingStrictModeEntries.set(browserWindow, pending);
  queueMicrotask(() => {
    if (pendingStrictModeEntries.get(browserWindow) === pending) {
      pendingStrictModeEntries.delete(browserWindow);
    }
  });
  return entry;
}

function extractRawDQueryValue(search: string): { valid: true; value?: string } | { valid: false } {
  let value: string | undefined;

  for (const parameter of search.slice(1).split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d") continue;
    if (separator === -1 || value !== undefined) return { valid: false };
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}
