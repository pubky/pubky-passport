import type { Pubky } from "@synonymdev/pubky";
import type { PassportMessageOverrides } from "../errors/messageTypes.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";

export type PubkyFacade = Pick<
  Pubky,
  "startGrantAuthFlow" | "resumeGrantAuthFlow" | "resumeDelegatedGrantAuthFlow" | "publicStorage"
>;

export interface PassportTimeouts {
  handshakeHintMs: number;
  closedGraceMs: number;
  ringGraceMs: number;
  detachedMs: number;
  finishingMs: number;
  attemptMs: number;
  ringLinkRotateMs: number;
  redirectStateTtlMs: number;
}

export interface PassportClientOptions {
  appName?: string;
  capabilities?: string;
  requireProfile?: boolean;
  pubky?: PubkyFacade;
  clientId?: string;
  instance?: string;
  allowCustomInstance?: boolean;
  allowedInstances?: readonly string[];
  relay?: string;
  returnPath?: string;
  popupBlocked?: "redirect" | "prompt" | "fail";
  onBeforeRedirect?: () => boolean | Promise<boolean>;
  allowLocalRedirectState?: boolean;
  allowBroadCapabilities?: boolean;
  messages?: PassportMessageOverrides;
  onDiagnostic?: (diagnostic: PassportDiagnostic) => void;
  timeouts?: Partial<PassportTimeouts>;
  development?: {
    allowLoopbackInstance?: boolean;
    openWindow?: (url: string, name: string, features: string) => Window | null;
  };
}
