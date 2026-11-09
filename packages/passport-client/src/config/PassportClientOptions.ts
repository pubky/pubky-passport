import type { Pubky } from "@synonymdev/pubky";
import type { PassportMessageOverrides } from "../errors/messageTypes.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";

export type PubkyFacade = Pick<
  Pubky,
  "startGrantAuthFlow" | "resumeDelegatedGrantAuthFlow" | "publicStorage" | "startCookieAuthFlow"
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
  /** "mainnet" (default) or "testnet"; a Passport on another network refuses the request. */
  network?: "mainnet" | "testnet";
  /** PKARR relay URLs for this client's SDK, as a list or comma-separated; required on testnet. */
  pkarrRelays?: string | readonly string[];
  /** The HTTP relay inbox URL the sign-in request uses; required on testnet. */
  httpRelay?: string;
}

export const PUBLIC_OPTIONS = [
  "instance",
  "appName",
  "clientId",
  "capabilities",
  "profile",
  "messages",
  "network",
  "pkarrRelays",
  "httpRelay",
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
