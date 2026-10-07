import type { Session } from "@synonymdev/pubky";
import type { PassportState, SessionInfo } from "../attempt/attemptModel.js";
import type { PassportAction } from "../errors/PassportError.js";
import type { MessageContext } from "../errors/messageTypes.js";
import type { InstanceChangeResult, PassportInstance } from "../instance/PassportInstance.js";
import type { ButtonView } from "../view/describeState.js";
import type { AttemptResult } from "./AttemptResult.js";
import type { PassportEntry } from "./PassportClient.js";

export type Unsubscribe = () => void;
/** `stray`: this page is a same-tab return that belongs to a sign-in in another tab. */
export type ReturnResult = "none" | "stray";

/** Keeps a Ring-ready flow alive while held; ringOpened pins it for ringGraceMs. */
export interface PreparedLease {
  release(): void;
  ringOpened(): void;
}

/** The element's and the tests' view of a client; apps get the smaller PassportClient. */
export interface InternalClient {
  /** Call in the click handler; never rejects. A blocked popup continues in this tab by itself. */
  signIn(entry?: PassportEntry): Promise<AttemptResult>;
  /** The screen the next sign-in opens Passport on, set by an element just before it acts. */
  setEntry(entry: PassportEntry | undefined): void;
  /** Turns the classic QR (legacy cookie sign-in) on or off for this device. */
  setClassicQr(on: boolean): void;
  classicQr(): boolean;
  /** Window-opening actions must be called in the click handler. */
  perform(action: PassportAction): void;
  prepare(): PreparedLease;
  cancel(): void;
  /** The same-tab return the client consumed by itself when it was created. Idempotent. */
  handleReturn(): ReturnResult;
  /** The large element's expired code: start a fresh Ring request in its place. */
  reloadRing(): void;
  /** What the client's texts are formatted with: the app's name and its own Passport. */
  messageContext(): Partial<MessageContext>;
  /** Call after the app signed out so the button returns. */
  reset(): void;
  getState(): PassportState;
  subscribe(listener: (state: PassportState) => void): Unsubscribe;
  /** The app owns every delivered Session. */
  onSession(listener: (session: Session, info: SessionInfo) => void): Unsubscribe;
  describe(state?: PassportState): ButtonView;
  getInstance(): PassportInstance;
  setInstance(input: string): InstanceChangeResult;
  resetInstance(): void;
  dispose(): void;
}
