import type { Session } from "@synonymdev/pubky";
import { vi } from "vitest";

import type { PassportGrantFlow, PassportPubky } from "../index";

export const INSTANCE = "https://passport.example";
export const PAGE_URL = "https://app.example/start?tab=1";
export const PAGE_ORIGIN = "https://app.example";
export const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
export const AUTHORIZATION_URL = `pubkyauth://signin_grant?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}&cid=example.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo`;

/** Gives jsdom an HTTPS page so same-origin HTTPS callbacks are valid. */
export function useHttpsPage(url = PAGE_URL): void {
  const dom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } })
    .jsdom;
  dom.reconfigure({ url });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Stands in for the WindowProxy `window.open` returns. */
export class FakePopup {
  closed = false;
  readonly close = vi.fn(() => {
    this.closed = true;
  });
  readonly focus = vi.fn();
  readonly postMessage = vi.fn();
  readonly location = { replace: vi.fn() };

  asWindow(): Window {
    return this as unknown as Window;
  }
}

/** A grant flow whose polls the test settles one by one. Records frees during a pending call. */
export class FakeFlow implements PassportGrantFlow {
  readonly authorizationUrl: string;
  readonly polls: Deferred<Session | undefined>[] = [];
  pending = 0;
  freeCalls = 0;
  freedWhilePending = 0;

  constructor(authorizationUrl = AUTHORIZATION_URL) {
    this.authorizationUrl = authorizationUrl;
  }

  readonly tryPollOnce = vi.fn(() => {
    if (this.freeCalls > 0) throw new Error("used after free");
    const poll = deferred<Session | undefined>();
    this.pending += 1;
    this.polls.push(poll);
    const settle = () => {
      this.pending -= 1;
    };
    poll.promise.then(settle, settle);
    return poll.promise;
  });

  readonly free = vi.fn(() => {
    this.freeCalls += 1;
    if (this.pending > 0) this.freedWhilePending += 1;
  });

  /** Settles the latest poll and lets the package react. */
  lastPoll(): Deferred<Session | undefined> {
    const poll = this.polls.at(-1);
    if (!poll) throw new Error("no poll started");
    return poll;
  }
}

export class FakePubky implements PassportPubky {
  readonly starts: Deferred<PassportGrantFlow>[] = [];
  readonly startGrantAuthFlow = vi.fn(() => {
    const start = deferred<PassportGrantFlow>();
    this.starts.push(start);
    return start.promise;
  });
}

export function fakeSession(): Session & { signout: ReturnType<typeof vi.fn> } {
  return {
    signout: vi.fn(() => Promise.resolve()),
    free: vi.fn(),
  } as unknown as Session & { signout: ReturnType<typeof vi.fn> };
}

/** Dispatches a `message` event as if `source` posted it from `origin`. */
export function postFrom(source: unknown, origin: string, data: unknown): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

export function outcomeMessage(outcome: string, messageId = "message-1"): Record<string, unknown> {
  return { type: "pubky-passport.authorization-outcome", version: 1, outcome, messageId };
}

export function returnMessage(attemptId: string, outcome: string): Record<string, unknown> {
  return { type: "pubky-passport-auth.return", version: 1, attemptId, outcome };
}
