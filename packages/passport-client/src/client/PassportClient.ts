import type { Session } from "@synonymdev/pubky";
import type { PassportErrorCode } from "../errors/PassportError.js";
import type { PassportProfile } from "../profile/PassportProfile.js";

/** Who signed in. The app owns the Session: store it, use it, and sign it out. */
export interface SignedIn {
  /**
   * A grant-backed Session by default; a cookie Session when the classic QR was on (Pubky Ring
   * older than 2.0). Both authenticate the same way; a cookie session cannot be listed or revoked
   * on its own and has no delegated restore.
   */
  readonly session: Session;
  /** The z-base-32 public key, without the `pubky` prefix. */
  readonly publicKey: string;
  /** The validated pubky.app profile; null only with `profile: "optional"` when there is none. */
  readonly profile: PassportProfile | null;
  /** The origin of the Passport that produced this sign-in; keep it with the Session. */
  readonly instance: string;
}

export interface PassportError extends Error {
  readonly name: "PassportError";
  readonly code: PassportErrorCode;
}

/**
 * Which Passport screen a sign-in opens on for someone without an identity there: Join, for a
 * "Join now" button (create an account), the Google sign-in, for a "Continue with Google" button,
 * or Sign in, for returning people (also Passport's own choice when none is given).
 */
export type PassportEntry = "join" | "google" | "sign-in";

export interface SignInOptions {
  /** The screen Passport opens on; Passport picks Sign in without it. */
  readonly entry?: PassportEntry;
}

export type SignInResult =
  | ({ readonly status: "signed-in" } & SignedIn)
  | { readonly status: "failed"; readonly error: PassportError }
  /** The browser blocked the pop-up, so this tab is going to Passport; nothing to do. */
  | { readonly status: "redirecting" };

/** Everything a custom button shows; the texts come from the built-in or your `messages`. */
export interface PassportView {
  /** The button label; empty once signed in. */
  readonly label: string;
  /** A line to show near the button: progress, a problem, or what to do next. */
  readonly status?: string;
  readonly tone: "neutral" | "busy" | "warning" | "error" | "success";
  /** A sign-in is under way; calling signIn() again brings its window forward. */
  readonly busy: boolean;
  /** Set from the moment a Session arrives until reset(), however the sign-in finished. */
  readonly signedIn?: SignedIn;
  /** The Passport a sign-in opens now: the app's own, or one the person chose (`isCustom`). */
  readonly instance: { readonly origin: string; readonly isCustom: boolean };
  /**
   * The classic QR is on for this device: requests use the legacy cookie sign-in that Pubky Ring
   * older than 2.0 needs (Bitkit refuses it). Off by default.
   */
  readonly classicQr: boolean;
}

export interface PassportClient {
  /** Call it from the click handler: it opens Passport (on `entry`, if given). Never rejects. */
  signIn(options?: SignInOptions): Promise<SignInResult>;
  /**
   * Turns the classic QR on or off for this device (kept in this origin's storage): on, the next
   * request (and a prepared QR code, replaced at once) uses the legacy cookie sign-in for Pubky
   * Ring older than 2.0. A sign-in under way keeps its request.
   */
  setClassicQr(on: boolean): void;
  describe(): PassportView;
  /** Calls the listener with the new view after every change; returns the unsubscribe. */
  subscribe(listener: (view: PassportView) => void): () => void;
  /** Cancels a sign-in in progress, or forgets the last one after the app signed out. */
  reset(): void;
  dispose(): void;
}
