import "@pubky/passport-client/element";
// Internal test hooks, not package exports: the Passport under test runs on a loopback origin,
// which only internal options allow, and the harness watches the element's client.
import { createInternalClient } from "/modules/client/createPassportClient.js";
import { setElementClientFactory } from "/modules/ui/PassportButtonElement.js";

let button;
const harness = {
  states: [],
  diagnostics: [],
  publicKeys: [],
  profiles: [],
  configure({
    instance,
    authorizationUrl,
    publicKey,
    capabilities,
    profile,
    variant,
    timeouts,
    numberLinks,
  }) {
    Object.assign(globalThis.__fakeSdk, {
      authorizationUrl,
      publicKey,
      capabilities: [capabilities],
      numberLinks: Boolean(numberLinks),
    });
    setElementClientFactory((options) => {
      const client = createInternalClient({
        ...options,
        ...(timeouts ? { timeouts } : {}),
        development: { allowLoopbackInstance: true },
        onDiagnostic: (diagnostic) => harness.diagnostics.push(diagnostic),
      });
      client.subscribe((state) => harness.states.push(state.status));
      harness.client = client;
      return client;
    });
    // The page's own markup: the public attributes only, set before the element joins the page.
    button = document.createElement("pubky-passport");
    button.id = "button";
    button.setAttribute("instance", instance);
    button.setAttribute("app-name", "ClientFixture");
    button.setAttribute("client-id", "client.example");
    button.setAttribute("capabilities", capabilities);
    if (profile) button.setAttribute("profile", profile);
    if (variant) button.setAttribute("variant", variant);
    button.addEventListener("passport-session", ({ detail }) => {
      harness.publicKeys.push(detail.publicKey);
      harness.profiles.push(detail.profile);
      document.querySelector("#who").textContent = `pubky${detail.publicKey}`;
    });
    document.querySelector("#mount").replaceChildren(button);
  },
  state: () => harness.client.getState(),
  reset: () => button.reset(),
};
globalThis.__facade = harness;
