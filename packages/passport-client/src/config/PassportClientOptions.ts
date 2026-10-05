import type { Pubky } from "@synonymdev/pubky";
import type { PassportMessageOverrides } from "../errors/messageTypes.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";

export type PubkyFacade = Pick<
  Pubky,
  "startGrantAuthFlow" | "resumeDelegatedGrantAuthFlow" | "publicStorage"
>;

export interface PassportTimeouts {
  handshakeHintMs: number;
  closedGraceMs: number;
  ringGraceMs: number;
  detachedMs: number;
  finishingMs: number;
  attemptMs: number;
  ringLinkRotateMs: number;
}

/** Everything an app can configure; `<pubky-passport>` takes the same options as attributes. */
export interface PassportClientOptions {
  /** The Passport origin (https). Default: the public Passport. */
  instance?: string;
  /** The name Passport shows. Default: the page's host name. */
  appName?: string;
  /** A stable ID for the app. Default: the page's host name. */
  clientId?: string;
  /** Pubky capabilities, e.g. "/pub/example.app/:rw". Empty asks for the identity only. */
  capabilities?: string;
  /** "required" (default): sign-in finishes only with a pubky.app profile. */
  profile?: "required" | "optional";
  /** Replaces any of the built-in texts. */
  messages?: PassportMessageOverrides;
}

export const PUBLIC_OPTIONS = [
  "instance",
  "appName",
  "clientId",
  "capabilities",
  "profile",
  "messages",
] as const satisfies readonly (keyof PassportClientOptions)[];

/** Internal: tests and the e2e fixtures. Never part of the public API. */
export interface InternalClientOptions extends PassportClientOptions {
  pubky?: PubkyFacade;
  onDiagnostic?: (diagnostic: PassportDiagnostic) => void;
  timeouts?: Partial<PassportTimeouts>;
  development?: {
    allowLoopbackInstance?: boolean;
    openWindow?: (url: string, name: string, features: string) => Window | null;
  };
}
