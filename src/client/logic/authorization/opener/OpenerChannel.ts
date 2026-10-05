import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { isRecord } from "@/libs/typeGuards";
import type { CodedFailure } from "@/libs/result";
import { requestDigest } from "@/libs/requestDigest";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";
import type { AuthorizationEntry, AuthorizationEntryCode } from "../entry/authorizationEntry";

const MAX_FEATURES = 16;
const FEATURE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const ATTEMPT_ID = /^[A-Za-z0-9_-]{16,64}$/u;
const REQUEST_DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const ACKNOWLEDGMENT_TIMEOUT_MS = 3_000;
/** How long a request document waits for its opener's hello before saying nobody is named. */
export const OPENER_HELLO_GRACE_MS = 1_000;
/**
 * `profile-setup`: Passport takes `profile-needed` for the Session an app holds (after a Pubky
 * Ring sign-in) and answers `profile-ready` once the profile is published.
 */
const SUPPORTED_FEATURES = ["outcome-v2", "status", "profile-setup"] as const;
const APPROVAL_FAILURE_REASONS = [
  "storage_unavailable",
  "identity_unavailable",
  "relay_unreachable",
  "approval_failed",
] as const;
export type OpenerApprovalFailureReason = (typeof APPROVAL_FAILURE_REASONS)[number];
type NonEmptyRequestState = Readonly<
  | { status: "valid" }
  | { status: "expired" | "completed" }
  | { status: "invalid"; code: AuthorizationEntryCode }
>;
export type OpenerRequestState = NonEmptyRequestState | Readonly<{ status: "empty" }>;
type OpenerPost =
  | { type: "pubky-passport.status"; phase: "ring" | "granting" }
  | {
      type: "pubky-passport.authorization-outcome";
      messageId: string;
      outcome: "success" | "error" | "cancel";
      code?: OpenerApprovalFailureReason;
    };
export type OpenerPostErrorCode = "opener_unavailable" | "post_failed";
export type OpenerPostResult = ResultType<void, CodedFailure<OpenerPostErrorCode>>;
export type VerifiedOpener = Readonly<{
  verifiedOrigin: string;
  attemptId: string;
  features: readonly string[];
  profile?: "required" | "optional";
  request?: string;
  /** The key a profile page's hello names instead of a request. */
  profileKey?: string;
}>;

let browserChannel: OpenerChannel | undefined;

/** Document-scoped metadata channel; it never holds a request URL or identity state. */
export class OpenerChannel {
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly acknowledgments = new Map<string, (accepted: boolean) => void>();
  private readonly empty: boolean;
  private request: OpenerRequestState;
  private binding: VerifiedOpener | undefined;
  private readonly installedAt = Date.now();
  /** The key of the Session the bound app holds for a missing profile (`profile-needed`). */
  private neededProfile: string | undefined;

  private constructor(
    private readonly appWindow: Window,
    private readonly opener: Window,
    request: OpenerRequestState,
    private readonly digest: string | undefined,
    /** A profile page (`/#profile=<key>`): only a hello naming this key binds. */
    private readonly profileKey?: string,
  ) {
    this.empty = request.status === "empty";
    this.request = safeRequestState(request);
  }

  /**
   * For a valid request the channel keeps its {@link requestDigest}; only a hello carrying the
   * same digest binds (A40), so a re-navigated named popup, or a request the opener did not
   * start, never names the opener as its requester.
   */
  static create(
    appWindow: Window,
    request: OpenerRequestState | AuthorizationEntry,
    requestDigestOverride?: string,
    profileKey?: string,
  ): OpenerChannel | undefined {
    let channel: OpenerChannel | undefined;
    try {
      const opener = appWindow.opener as Window | null;
      if (!opener) return undefined;
      const url =
        "request" in request && request.status === "valid"
          ? request.request.validatedUrlForApproval()
          : undefined;
      const digest = requestDigestOverride ?? (url === undefined ? undefined : requestDigest(url));
      channel = new OpenerChannel(appWindow, opener, request, digest, profileKey);
      channel.listen();
      return channel;
    } catch (e) {
      channel?.dispose();
      logChannelFailure("install", e);
      return undefined;
    }
  }

  /**
   * The opener bound to the request on screen (A39/M1): only a request document whose hello
   * matched its digest; never `/` (a reloaded popup or manual entry) or an unusable request.
   */
  verifiedOpener(): VerifiedOpener | undefined {
    return this.digest === undefined ? undefined : this.binding;
  }

  /** The app that opened this profile page for its key, once its hello named that key. */
  profileOpener(): VerifiedOpener | undefined {
    return this.profileKey === undefined ? undefined : this.binding;
  }

  /**
   * The key whose profile the bound app asked for after its Pubky Ring sign-in. Only a prompt:
   * it never approves or changes the request, and the app still reads the profile itself.
   */
  profileRequest(): string | undefined {
    return this.neededProfile;
  }

  /** Drops a `profile-needed` Passport did not take, so a later one can be taken. */
  forgetProfileRequest(): void {
    this.neededProfile = undefined;
  }

  /** Tells the bound app its profile is published, so it reads it again and finishes. */
  postProfileReady(): OpenerPostResult {
    if (this.neededProfile === undefined && this.profileOpener() === undefined)
      return Result.err({ code: "opener_unavailable" });
    return this.send({ type: "pubky-passport.profile-ready" });
  }

  /**
   * Milliseconds left in which a hello can still bind this request document, so the page does not
   * flash "names no website" at an app whose hello is on its way; 0 once bound or elapsed.
   */
  helloGraceRemaining(now = Date.now()): number {
    if (this.digest === undefined || this.binding || this.lifetime.signal.aborted) return 0;
    return Math.max(0, this.installedAt + OPENER_HELLO_GRACE_MS - now);
  }

  subscribe(listener: () => void): () => void {
    if (this.lifetime.signal.aborted) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  updateRequestState(request: Exclude<NonEmptyRequestState, { status: "valid" }>): void {
    if (this.empty || this.lifetime.signal.aborted || this.request.status === "completed") return;
    this.request = safeRequestState(request);
  }

  post(message: OpenerPost): OpenerPostResult {
    if (this.empty) return Result.err({ code: "opener_unavailable" });
    if (
      message.type === "pubky-passport.status" &&
      (this.request.status !== "valid" ||
        (message.phase !== "ring" && message.phase !== "granting"))
    )
      return Result.err({ code: "post_failed" });
    if (
      message.type === "pubky-passport.authorization-outcome" &&
      (!isMessageId(message.messageId) ||
        (message.code !== undefined && !APPROVAL_FAILURE_REASONS.includes(message.code)))
    )
      return Result.err({ code: "post_failed" });
    const payload =
      message.type === "pubky-passport.status"
        ? { type: message.type, phase: message.phase }
        : {
            type: message.type,
            messageId: message.messageId,
            outcome: message.outcome,
            ...(message.code ? { code: message.code } : {}),
          };
    const result = this.send(payload);
    if (Result.isOk(result) && message.type === "pubky-passport.authorization-outcome")
      this.updateRequestState({ status: "completed" });
    return result;
  }

  waitForAck(
    messageId: string,
    signal: AbortSignal,
  ): { result: Promise<boolean>; cancel: () => void } {
    if (
      this.empty ||
      !this.binding ||
      this.lifetime.signal.aborted ||
      signal.aborted ||
      !isMessageId(messageId)
    )
      return { result: Promise.resolve(false), cancel: () => undefined };
    this.acknowledgments.get(messageId)?.(false);
    let resolve!: (accepted: boolean) => void;
    const result = new Promise<boolean>((done) => {
      resolve = done;
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish(false);
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      this.acknowledgments.delete(messageId);
      for (const cleanup of [
        () => clearTimeout(timer),
        () => signal.removeEventListener("abort", onAbort),
      ]) {
        try {
          cleanup();
        } catch (e) {
          logChannelFailure("ack_cleanup", e);
        }
      }
      resolve(accepted);
    };
    this.acknowledgments.set(messageId, finish);
    try {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) finish(false);
      if (!settled) timer = setTimeout(() => finish(false), ACKNOWLEDGMENT_TIMEOUT_MS);
    } catch (e) {
      logChannelFailure("ack_setup", e);
      finish(false);
    }
    return { result, cancel: () => finish(false) };
  }

  dispose(): void {
    this.lifetime.abort();
    for (const finish of this.acknowledgments.values()) finish(false);
    this.binding = undefined;
    this.listeners.clear();
    if (browserChannel === this) browserChannel = undefined;
  }

  private listen(): void {
    this.appWindow.addEventListener(
      "message",
      (event) => {
        if (
          !acceptsOrigin(event.origin) ||
          (this.binding && event.origin !== this.binding.verifiedOrigin)
        )
          return;
        if (event.source !== this.opener || event.source !== this.appWindow.opener) return;
        const data: unknown = event.data;
        if (isRecord(data) && data.type === "pubky-passport.profile-needed") {
          // Only from the app bound to this request (A39/A40), for one key, once.
          if (
            this.digest !== undefined &&
            this.binding &&
            this.neededProfile === undefined &&
            data.version === 2 &&
            data.attemptId === this.binding.attemptId &&
            isPubkyPublicKey(data.publicKey)
          ) {
            this.neededProfile = data.publicKey;
            this.notify();
          }
          return;
        }
        if (isRecord(data) && data.type === "pubky-passport.authorization-outcome-ack") {
          if (
            !this.empty &&
            this.binding &&
            data.version === 2 &&
            data.attemptId === this.binding.attemptId &&
            isMessageId(data.messageId)
          )
            this.acknowledgments.get(data.messageId)?.(true);
          return;
        }
        const hello = parseHello(data);
        if (!hello || (this.binding && hello.attemptId !== this.binding.attemptId)) return;
        if (!this.binding && this.digest !== undefined && hello.request !== this.digest) return;
        if (!this.binding && this.profileKey !== undefined && hello.profileKey !== this.profileKey)
          return;
        const first = !this.binding;
        this.binding ??= Object.freeze({ verifiedOrigin: event.origin, ...hello });
        // Reply before callbacks: their identity/account reads must not affect ready timing.
        this.replyReady();
        if (first) this.notify();
      },
      { signal: this.lifetime.signal },
    );
    this.appWindow.addEventListener("pagehide", () => this.dispose(), {
      once: true,
      signal: this.lifetime.signal,
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        logChannelFailure("listener", e);
      }
    }
  }

  private replyReady(): void {
    this.send({
      type: "pubky-passport.ready",
      protocols: [1, 2],
      features: [...SUPPORTED_FEATURES],
      request: this.request,
    });
  }

  private send(payload: Record<string, unknown>): OpenerPostResult {
    const binding = this.binding;
    if (!binding || this.lifetime.signal.aborted) return Result.err({ code: "opener_unavailable" });
    try {
      this.opener.postMessage(
        {
          ...payload,
          version: 2,
          attemptId: binding.attemptId,
        },
        binding.verifiedOrigin,
      );
      return Result.ok();
    } catch (e) {
      logChannelFailure("post", e);
      return Result.err({ code: "post_failed", cause: e });
    }
  }
}

function isMessageId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

export function installOpenerChannel(
  appWindow: Window,
  entry: AuthorizationEntry,
  profileKey?: string,
): void {
  browserChannel?.dispose();
  browserChannel = OpenerChannel.create(appWindow, entry, undefined, profileKey);
}

/** Returns the document-owned channel; pagehide releases it, not a component unmount. */
export function takeOpenerChannel(): OpenerChannel | undefined {
  return browserChannel;
}

function acceptsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function parseHello(value: unknown): Omit<VerifiedOpener, "verifiedOrigin"> | undefined {
  if (
    !isRecord(value) ||
    value.type !== "pubky-passport.hello" ||
    value.version !== 2 ||
    typeof value.attemptId !== "string" ||
    !ATTEMPT_ID.test(value.attemptId) ||
    !Array.isArray(value.features) ||
    value.features.length > MAX_FEATURES
  )
    return undefined;
  for (const feature of value.features)
    if (typeof feature !== "string" || !FEATURE_TOKEN.test(feature)) return undefined;
  return {
    attemptId: value.attemptId,
    features: Object.freeze([...value.features]),
    ...(typeof value.request === "string" && REQUEST_DIGEST.test(value.request)
      ? { request: value.request }
      : {}),
    ...(value.profile === "required" || value.profile === "optional"
      ? { profile: value.profile }
      : {}),
    ...(isPubkyPublicKey(value.profileKey) ? { profileKey: value.profileKey } : {}),
  };
}

function safeRequestState(request: OpenerRequestState): OpenerRequestState {
  return Object.freeze(
    request.status === "invalid"
      ? { status: request.status, code: request.code }
      : { status: request.status },
  );
}

function logChannelFailure(operation: string, cause: unknown): void {
  LOGGER.warn("authorize.opener.failed", { operation, ...safeErrorLogFields(cause) });
}
