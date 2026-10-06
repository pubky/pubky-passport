import { Result } from "better-result";
import { act } from "@testing-library/react";
import { vi } from "vitest";

import {
  installOpenerChannel,
  takeOpenerChannel,
} from "@/client/logic/authorization/opener/OpenerChannel";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { requestDigest } from "@/libs/requestDigest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

/**
 * Makes this page an app's popup whose request channel is installed, as the page entry does before
 * any hello arrives: screens stay neutral during the hello grace. `hello(origin)` then binds it.
 */
export function installTestOpener(): { hello(origin: string): void } {
  const opener = { postMessage: vi.fn() };
  vi.stubGlobal("opener", opener);
  const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
  if (Result.isError(validated)) throw new Error(validated.error.code);
  installOpenerChannel(window, { status: "valid", request: validated.value });
  return {
    hello(origin) {
      act(() => {
        window.dispatchEvent(
          Object.assign(new Event("message"), {
            source: opener,
            origin,
            data: {
              type: "pubky-passport.hello",
              version: 2,
              attemptId: "0123456789abcdef",
              features: [],
              request: requestDigest(REQUEST),
            },
          }),
        );
      });
      if (!takeOpenerChannel()?.verifiedOpener()) throw new Error("The test opener did not bind.");
    },
  };
}

/**
 * Makes this page an app's popup whose v2 hello bound the request (A39), from `origin`: screens
 * then name a verified requester. Pair with {@link releaseTestOpener} after each test.
 */
export function bindTestOpener(origin: string): void {
  installTestOpener().hello(origin);
}

/** Removes the channel {@link bindTestOpener} installed. */
export function releaseTestOpener(): void {
  takeOpenerChannel()?.dispose();
  vi.unstubAllGlobals();
}
