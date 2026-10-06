import { isAttemptId } from "../shared/attemptId.js";
import type { FlowCallbacks } from "./FlowPort.js";

/** The page a same-tab sign-in comes back to: this one, without its query or fragment. */
export function returnPage(page: Pick<Location, "origin" | "pathname">): string {
  return new URL(page.pathname, page.origin).href;
}

/** Passport sends the person back here, marked with the attempt and how it ended. */
export function returnCallbacks(returnTo: string, attemptId: string): FlowCallbacks {
  if (!isAttemptId(attemptId)) throw new Error("Invalid attempt");
  const callback = (kind: "s" | "e" | "c") => {
    const url = new URL(returnTo);
    url.search = `?pubky-passport=${kind}.${attemptId}`;
    return url.href;
  };
  return { xSuccess: callback("s"), xError: callback("e"), xCancel: callback("c") };
}
