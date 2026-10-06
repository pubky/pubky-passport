import type { Session } from "@synonymdev/pubky";
import type { PassportErrorCode } from "../errors/PassportError.js";
import type { PassportProfile } from "../profile/PassportProfile.js";

/** Who signed in. The app owns the Session: store it, use it, and sign it out. */
export interface SignedIn {
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
}

export interface PassportClient {
  /** Call it from the click handler: it opens Passport. Never rejects. */
  signIn(): Promise<SignInResult>;
  describe(): PassportView;
  /** Calls the listener with the new view after every change; returns the unsubscribe. */
  subscribe(listener: (view: PassportView) => void): () => void;
  /** Cancels a sign-in in progress, or forgets the last one after the app signed out. */
  reset(): void;
  dispose(): void;
}
