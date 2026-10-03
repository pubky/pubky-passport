import { parsePassportMessage } from "/modules/protocol/passportMessages.js";
import { requestDigest } from "/modules/shared/requestDigest.js";

const attemptId = "client-wire-attempt-0001";
const harness = {
  popup: null,
  origin: "",
  messages: [],
  open(url) {
    harness.origin = new URL(url).origin;
    // A40: the hello names the request by digest; the fragment carries the encoded request.
    harness.request = requestDigest(decodeURIComponent(new URL(url).hash.slice("#d=".length)));
    harness.popup = window.open(url, "client-schema-test", "popup,width=520,height=760");
  },
  hello() {
    harness.popup?.postMessage(
      {
        type: "pubky-passport.hello",
        version: 2,
        attemptId,
        features: ["outcome-v2", "status"],
        profile: "optional",
        request: harness.request,
      },
      harness.origin,
    );
  },
  ack() {
    const outcome = harness.messages.find(
      (message) => message.type === "pubky-passport.authorization-outcome",
    );
    if (outcome)
      harness.popup?.postMessage(
        {
          type: "pubky-passport.authorization-outcome-ack",
          version: outcome.version,
          messageId: outcome.messageId,
          ...(outcome.version === 2 ? { attemptId } : {}),
        },
        harness.origin,
      );
  },
};
window.addEventListener("message", (event) => {
  if (event.origin !== harness.origin || event.source !== harness.popup) return;
  const message = parsePassportMessage(event.data);
  if (message) harness.messages.push(message);
});
window.__wireHarness = harness;
