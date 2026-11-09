import "@pubky/passport-client/element";
// Internal test hooks, not package exports: the Passport under test runs on a loopback origin,
// which only internal options allow, and the harness watches the element's client.
import { createInternalClient } from "/modules/client/createPassportClient.js";
import { createPassportClient } from "@pubky/passport-client";
import { setElementClientFactory } from "/modules/ui/PassportButtonElement.js";

let button;
const harness = {
  states: [],
  diagnostics: [],
  publicKeys: [],
  sessionTargets: [],
  profiles: [],
  /** Every `classicQr` the headless client's subscribers were told, in order. */
  headlessViews: [],
  configure({
    instance,
    authorizationUrl,
    publicKey,
    capabilities,
    profile,
    variant,
    entry,
    timeouts,
    numberLinks,
    syncGroup,
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
    // With `syncGroup`, a hero, a header and a footer element share one sign-in.
    const members = (syncGroup ? ["button", "header", "footer"] : ["button"]).map((id) => {
      const element = document.createElement("pubky-passport");
      element.id = id;
      element.setAttribute("instance", instance);
      element.setAttribute("app-name", "ClientFixture");
      element.setAttribute("client-id", "client.example");
      element.setAttribute("capabilities", capabilities);
      if (profile) element.setAttribute("profile", profile);
      if (variant && id === "button") element.setAttribute("variant", variant);
      if (entry && id === "button") element.setAttribute("entry", entry);
      if (syncGroup) element.setAttribute("sync-group", syncGroup);
      element.addEventListener("passport-session", ({ detail, target }) => {
        harness.sessionTargets.push(target.id);
        harness.publicKeys.push(detail.publicKey);
        harness.profiles.push(detail.profile);
        document.querySelector("#who").textContent = `pubky${detail.publicKey}`;
      });
      return element;
    });
    button = members[0];
    document.querySelector("#mount").replaceChildren(...members);
  },
  /** The headless API, as an app without the element builds it from the package's exports. */
  headless(options) {
    harness.headlessClient = createPassportClient(options);
    harness.headlessClient.subscribe((view) => harness.headlessViews.push(view.classicQr));
  },
  state: () => harness.client.getState(),
  reset: () => button.reset(),
};
globalThis.__facade = harness;
