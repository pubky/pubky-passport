import { BrowserPopup } from "/modules/popup/BrowserPopup.js";
import { PassportChannel } from "/modules/protocol/PassportChannel.js";
import { requestDigest } from "/modules/shared/requestDigest.js";

const attemptId = "client-channel-attempt-01";
const popupPort = new BrowserPopup();
let request;
let channel;
let confirmed = false;
const harness = {
  events: [],
  diagnostics: [],
  failures: 0,
  configure(origin, authorizationUrl) {
    request = {
      instance: { origin, host: new URL(origin).host, isCustom: false },
      authorizationUrl,
      attemptId,
      generation: 0,
    };
  },
  dispose() {
    channel?.dispose();
    popupPort.dispose();
  },
};
document.querySelector("#open").addEventListener("click", () => {
  const popup = popupPort.open(request);
  if (!popup) return;
  channel = new PassportChannel(attemptId, "optional", popupPort, {
    event(event) {
      harness.events.push(event);
      if (event.type === "READY" && !confirmed) {
        confirmed = true;
        channel.stopHandshake();
        channel.startHeartbeat();
      }
      if (event.type === "OUTCOME") {
        channel.ack(event.messageId, event.version);
        channel.stopHandshake();
        channel.stopHeartbeat();
      }
    },
    diagnostic(diagnostic) {
      harness.diagnostics.push(diagnostic);
    },
    failed() {
      harness.failures++;
    },
  });
  channel.startHandshake(popup, request.instance.origin, requestDigest(request.authorizationUrl));
});
window.__channelHarness = harness;
