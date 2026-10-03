/**
 * The demo page: layout, rendering and the playground. The sign-in itself (keep, restore, sign
 * out) is passport.ts; this file decides what the page shows.
 */
import { createPassportClient, type PassportClient, type SignedIn } from "@pubky/passport-client";
import { APP_NAME } from "./config";
import { byId, h } from "./dom";
import { explainer } from "./explainer";
import { renderFiles } from "./files";
import { keepSignIn, onSignIn, restoreSignIn, signOut } from "./passport";
import { createStyleGallery } from "./styles";
import {
  DEFAULT_SETTINGS,
  clearSettings,
  configureElement,
  elementAttributes,
  firstSignIn,
  loadSettings,
  passportOptions,
  saveSettings,
  type PlaygroundSettings,
} from "./settings";

let settings = loadSettings();
/** The small button in the header and the element whose style the playground picks. */
const headerButton = document.createElement("pubky-passport");
const mainButton = document.createElement("pubky-passport");
/** The headless client behind the gallery's own button and text link. */
let client: PassportClient;
const gallery = createStyleGallery(() => void client.signIn());
/** Every <pubky-passport> on the page; they share one set of options. */
const elements = [headerButton, mainButton, ...gallery.elements];
let unsubscribe = () => {};
const signIn = firstSignIn(showSignedIn);

export async function start(root: HTMLElement): Promise<void> {
  // Buttons get their options before they join the page (see configureElement in settings.ts).
  if (!apply(settings)) apply({ ...DEFAULT_SETTINGS });
  root.replaceChildren(...layout());
  for (const button of elements) onSignIn(button, signIn.take);
  byId("sign-out").addEventListener("click", () => void onSignOut());
  bindPlayground();
  gallery.renderHeadless(client.describe());
  bindTabs();
  const saved = await restoreSignIn();
  if (saved) signIn.take(saved);
}

async function onSignOut(): Promise<void> {
  const signedIn = signIn.end();
  if (!signedIn) return;
  const button = byId<HTMLButtonElement>("sign-out");
  button.disabled = true;
  button.textContent = "Signing out…";
  await signOut(signedIn, [...elements, client]);
  showSignedOut();
  button.disabled = false;
  button.textContent = "Sign out";
}

/** Configures every button from the playground; false leaves everything as it was. */
function apply(next: PlaygroundSettings): boolean {
  let nextClient: PassportClient;
  try {
    nextClient = createPassportClient(passportOptions(next));
  } catch (error) {
    const text = document.getElementById("config-error");
    if (text) text.textContent = `Not applied. ${error instanceof Error ? error.message : ""}`;
    return false;
  }
  unsubscribe();
  client?.dispose();
  client = nextClient;
  unsubscribe = client.subscribe((view) => {
    gallery.renderHeadless(view);
    // The view keeps signedIn until reset(): take() turns the same Session away after the first.
    if (view.signedIn && signIn.take(view.signedIn)) void keepSignIn(view.signedIn).catch(() => {});
  });
  for (const button of elements) configureElement(button, next);
  mainButton.setAttribute("variant", next.variant);
  settings = next;
  saveSettings(next);
  return true;
}

function showSignedIn({ publicKey, profile, session }: SignedIn): void {
  for (const button of [...elements, ...gallery.controls]) button.hidden = true;
  byId("sign-out").hidden = false;
  byId("who").textContent = profile?.name ?? `pubky${publicKey}`;
  const panel = byId("account");
  panel.hidden = false;
  const heading = h(
    "h2",
    { tabindex: "-1" },
    profile ? `Signed in as ${profile.name}` : "Signed in",
  );
  panel.replaceChildren(
    heading,
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Public key"),
      h("dd", { class: "mono" }, `pubky${publicKey}`),
      h("dt", {}, "Bio"),
      h("dd", {}, profile ? (profile.bio ?? "(no bio)") : "No profile (optional here)"),
    ),
    h("div", { id: "files" }),
  );
  // The sign-in button just left the page: focus moves to what took its place.
  heading.focus();
  void renderFiles(byId("files"), session);
}

function showSignedOut(): void {
  for (const button of [...elements, ...gallery.controls]) button.hidden = false;
  byId("sign-out").hidden = true;
  byId("who").textContent = "";
  byId("account").hidden = true;
  byId("account").replaceChildren();
  byId("playground-title").focus();
}

/** Two tabs: the demo, and the developer's guide. The hash keeps the open one across reloads. */
function bindTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (id: string) => {
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      byId(tab.getAttribute("aria-controls")!).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      select(tab.id);
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}${tab.id === "tab-guide" ? "#guide" : ""}`,
      );
    });
    // Arrow, Home and End keys move between tabs, as tab lists do.
    tab.addEventListener("keydown", (event) => {
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
      const at = tabs.indexOf(tab);
      const to =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : event.key in moves
              ? (at + moves[event.key]! + tabs.length) % tabs.length
              : at;
      if (to === at) return;
      event.preventDefault();
      tabs[to]!.focus();
      tabs[to]!.click();
    });
  }
  select(location.hash === "#guide" ? "tab-guide" : "tab-demo");
}

function bindPlayground(): void {
  const form = byId<HTMLFormElement>("playground-form");
  const fill = () => {
    for (const [name, value] of Object.entries(settings)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
        field.value = value;
    }
    renderSnippet();
    gallery.renderCode(settings);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const next: PlaygroundSettings = {
      instance: String(data.get("instance") ?? "").trim(),
      profile: data.get("profile") === "optional" ? "optional" : "required",
      variant: data.get("variant") === "large" ? "large" : "small",
    };
    if (apply(next)) byId("config-error").textContent = "";
    fill();
  });
  byId("playground-reset").addEventListener("click", () => {
    clearSettings();
    apply({ ...DEFAULT_SETTINGS });
    byId("config-error").textContent = "";
    fill();
  });
  const copy = byId<HTMLButtonElement>("copy-snippet");
  copy.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(byId("snippet").textContent ?? "");
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy this snippet"), 1500);
  });
  fill();
}

/** The markup for the current playground settings (the import needs a bundler). */
function renderSnippet(): void {
  const attributes = [
    ...elementAttributes(settings).map(([name, value]) => `${name}="${value}"`),
    ...(settings.variant === "large" ? ['variant="large"'] : []),
  ];
  byId("snippet").textContent = [
    '<script type="module">',
    '  import "@pubky/passport-client/element"; // with a bundler such as Vite',
    '  document.querySelector("pubky-passport").addEventListener("passport-session", (event) => {',
    "    const { session, publicKey, profile } = event.detail; // session: your SDK Session",
    "  });",
    "</script>",
    `<pubky-passport ${attributes.join(" ")}></pubky-passport>`,
  ].join("\n");
}

function layout(): Node[] {
  headerButton.id = "header-button";
  mainButton.id = "main-button";
  const tab = (id: string, panelId: string, label: string) =>
    h("button", { id, type: "button", role: "tab", "aria-controls": panelId }, label);
  return [
    h(
      "header",
      { class: "top" },
      h("strong", {}, APP_NAME),
      h("span", { id: "who", class: "who" }),
      headerButton,
      h("button", { id: "sign-out", type: "button", hidden: true }, "Sign out"),
    ),
    h(
      "nav",
      { class: "tabs", role: "tablist", "aria-label": "Demo sections" },
      tab("tab-demo", "demo", "Demo"),
      tab("tab-guide", "guide", "Use it in your app"),
    ),
    h(
      "main",
      {},
      h(
        "div",
        {
          id: "demo",
          class: "grid",
          role: "tabpanel",
          "aria-labelledby": "tab-demo",
          tabindex: "0",
        },
        h("section", { id: "account", class: "panel wide", hidden: true }),
        h(
          "section",
          { class: "panel wide playground", "aria-labelledby": "playground-title" },
          h("h2", { id: "playground-title", tabindex: "-1" }, "Playground"),
          h(
            "div",
            { class: "playground-grid" },
            // The element to play with, on its own stage, apart from the settings that shape it.
            h("div", { class: "stage" }, mainButton),
            h(
              "div",
              { class: "settings" },
              h(
                "form",
                { id: "playground-form", class: "form-grid" },
                h(
                  "label",
                  {},
                  "Passport URL",
                  // Empty: the package's own Passport.
                  h("input", { name: "instance", placeholder: "https://passport.pubky.app" }),
                ),
                select("Style", "variant", [
                  ["small", "Small (button)"],
                  ["large", "Large (button and Pubky Ring QR)"],
                ]),
                select("Profile", "profile", [
                  ["required", "Required: sign-in makes sure one exists"],
                  ["optional", "Optional: sign in without one"],
                ]),
                h(
                  "div",
                  { class: "actions" },
                  h("button", { type: "submit", class: "primary" }, "Apply"),
                  h("button", { id: "playground-reset", type: "button" }, "Reset to defaults"),
                ),
                h("p", { id: "config-error", class: "status error", role: "alert" }),
              ),
              h("h3", {}, "Snippet"),
              h("pre", { id: "snippet", class: "mono", tabindex: "0" }),
              h("button", { id: "copy-snippet", type: "button" }, "Copy this snippet"),
            ),
          ),
        ),
        gallery.section,
      ),
      h(
        "div",
        {
          id: "guide",
          class: "grid",
          role: "tabpanel",
          "aria-labelledby": "tab-guide",
          tabindex: "0",
          hidden: true,
        },
        explainer(),
      ),
    ),
  ];
}

function select(label: string, name: string, options: [string, string][]): HTMLElement {
  return h(
    "label",
    {},
    label,
    h("select", { name }, ...options.map(([value, text]) => h("option", { value }, text))),
  );
}
