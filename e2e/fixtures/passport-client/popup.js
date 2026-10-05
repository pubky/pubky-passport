import { BrowserPopup } from "/modules/popup/BrowserPopup.js";
import { openPassportPopup } from "/modules/popup/openPassportPopup.js";

const adapter = new BrowserPopup();
let configuration;
const harness = {
  popup: null,
  closed: 0,
  failures: 0,
  configure(origin, authorizationUrl, prepared) {
    configuration = { instance: { origin }, authorizationUrl, prepared };
  },
  navigate() {
    return adapter.navigate(harness.popup, configuration.instance, configuration.authorizationUrl);
  },
  focus() {
    adapter.focus(harness.popup);
  },
  close() {
    adapter.close(harness.popup);
  },
  dispose() {
    adapter.dispose();
  },
};
document.getElementById("open").addEventListener("click", () => {
  const opened = openPassportPopup(adapter, {
    instance: configuration.instance,
    attemptId: "client-popup-attempt-001",
    generation: 0,
    ...(configuration.prepared ? { authorizationUrl: configuration.authorizationUrl } : {}),
  });
  harness.popup = opened.kind === "live" ? opened.popup : null;
  if (harness.popup)
    adapter.watch(
      harness.popup,
      () => {
        harness.closed++;
      },
      () => {
        harness.failures++;
      },
    );
});
window.__popupHarness = harness;
