import { afterEach, describe, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import type { ClientPlatform } from "../client/ClientRuntime.js";
import { createClient } from "../client/createPassportClient.js";
import type { InternalClient } from "../client/InternalClient.js";
import type { InternalClientOptions } from "../config/PassportClientOptions.js";
import { validateCapabilities } from "../flow/pubkyFlowAdapter.js";
import type { ProfileRead } from "../profile/PassportProfile.js";
import "../element.js";
import { setElementClientFactory, type PassportButtonElement } from "./PassportButtonElement.js";

const PROFILE = { name: "Alice" };
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  setElementClientFactory(undefined);
  document.body.replaceChildren();
  localStorage.clear();
});

/** Builds every element client on fake browser and SDK ports; `current()` is the newest one. */
function fakes(
  windows: Window[] = [],
  readProfile: () => Promise<ProfileRead> = async () => ({ kind: "found", profile: PROFILE }),
) {
  const clock = new FakeClock();
  const flows: FakeFlowPort[] = [];
  const created: InternalClient[] = [];
  const options: InternalClientOptions[] = [];
  const opened: string[] = [];
  const platform: ClientPlatform = {
    available: () => true,
    window: () => window,
    clock,
    flowPort: () => ({
      async start() {
        const flow = new FakeFlowPort(`pubkyauth://signin?secret=flow-${flows.length}`);
        flows.push(flow);
        return { ok: true, value: flow };
      },
      resume: () => Promise.reject(new Error("no return")),
      sessionInfo: () => ({ ok: true, value: { publicKey: "approved-key", capabilities: [] } }),
    }),
    readProfile,
    validateCapabilities,
  };
  setElementClientFactory((given) => {
    options.push(given);
    const client = createClient(
      {
        instance: "https://passport.example",
        ...given,
        development: {
          openWindow: (url: string) => {
            opened.push(url);
            return windows.shift() ?? null;
          },
        },
      },
      platform,
    );
    created.push(client);
    return client;
  });
  cleanups.push(async () => {
    for (const client of created) client.dispose();
    for (const flow of flows) if (flow.pending) flow.settle();
    await flush();
    clock.advance(5000);
  });
  return { flows, options, opened, clock, created, current: () => created.at(-1)! };
}

async function mount(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  const element = host.firstElementChild as PassportButtonElement;
  document.body.append(host);
  await flush();
  return element;
}

const button = (element: PassportButtonElement) =>
  element.shadowRoot!.querySelector<HTMLButtonElement>('[part="button"]')!;

test("a bare tag renders the Continue with Pubky button without any options", async () => {
  const element = await mount("<pubky-passport></pubky-passport>");
  expect(button(element)).toHaveTextContent("Continue with Pubky");
  expect(button(element)).not.toHaveAttribute("disabled");
  // The Passport is chosen from the settings control on the button, not a link below it.
  const settings = element.shadowRoot!.querySelector('[part="settings"]')!;
  expect(settings).toHaveAttribute("aria-label", "Use a different Passport");
  expect(settings).toHaveAttribute("aria-expanded", "false");
  expect(element.shadowRoot!.querySelector('[data-slot="pill"]')).toContainElement(
    settings as HTMLElement,
  );
  expect(element.shadowRoot!.querySelector('[data-slot="picker"]')).toBeNull();
  // The element's client stays inside it.
  expect("client" in element).toBe(false);
  expect("pubky" in element).toBe(false);
  expect(customElements.get("pubky-passport-button")).toBeUndefined();
});

test("a click opens Passport; the Session with its profile hides the element; reset() restores it", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { flows, current } = fakes([popup.window]);
  const element = await mount("<pubky-passport></pubky-passport>");
  const events = vi.fn();
  for (const type of [
    "passport-session",
    "passport-state",
    "passport-error",
    "passport-diagnostic",
  ])
    element.addEventListener(type, events);
  button(element).click();
  await flush();
  expect(current().getState().status).toBe("opening");
  expect(button(element)).toHaveTextContent("Opening Passport…");
  expect(button(element)).toHaveAttribute("aria-busy", "true");
  const session = new FakeSession();
  flows[0]!.settle(session.session);
  await flush();
  expect(events).toHaveBeenCalledOnce();
  const event = events.mock.calls[0]![0] as CustomEvent;
  expect(event.type).toBe("passport-session");
  expect(event.detail).toEqual({
    session: session.session,
    publicKey: "approved-key",
    profile: PROFILE,
    instance: "https://passport.example",
  });
  expect(element.shadowRoot!.firstElementChild!.childNodes).toHaveLength(0);
  expect(element.shadowRoot!.querySelector('[part="button"]')).toBeNull();
  element.reset();
  await flush();
  expect(button(element)).toHaveTextContent("Continue with Pubky");
  session.session.free();
});

test("the six attributes configure the client; profile defaults to required", async () => {
  const { options } = fakes();
  const element = await mount(
    '<pubky-passport instance="https://passport.example" app-name="Example" client-id="example" capabilities="/pub/example.app/:rw" variant="large"></pubky-passport>',
  );
  expect(options.at(-1)).toEqual({
    instance: "https://passport.example",
    appName: "Example",
    clientId: "example",
    capabilities: "/pub/example.app/:rw",
  });
  expect(element.shadowRoot!.querySelector(".large")).not.toBeNull();
  element.setAttribute("profile", "optional");
  await flush();
  expect(options.at(-1)).toMatchObject({ profile: "optional" });
});

test("the network attributes configure the client and rebuild it when they change", async () => {
  const { options, created } = fakes();
  const element = await mount(
    '<pubky-passport network="testnet" pkarr-relays="https://app.example/_pubky/pkarr, http://localhost:15411" http-relay="https://app.example/_pubky/relay/inbox"></pubky-passport>',
  );
  expect(options.at(-1)).toEqual({
    network: "testnet",
    pkarrRelays: "https://app.example/_pubky/pkarr, http://localhost:15411",
    httpRelay: "https://app.example/_pubky/relay/inbox",
  });
  expect(button(element)).toBeDefined();
  const first = created.length;
  element.setAttribute("http-relay", "https://app.example/_pubky/relay2/inbox");
  await flush();
  expect(created.length).toBe(first + 1);
  // A testnet without its relays is a configuration error, not a mainnet fallback.
  element.removeAttribute("pkarr-relays");
  await flush();
  expect(element.shadowRoot!.textContent).toBe("Passport button not configured");
});

test.each([
  ['instance="http://insecure.example"', 'instance="https://passport.example"'],
  ['profile="sometimes"', 'profile="optional"'],
  ['network="devnet"', 'network="mainnet"'],
  ['http-relay="http://relay.example/inbox"', 'http-relay="https://relay.example/inbox"'],
  ["messages='{\"label.idle\": 1}'", 'messages=\'{"label.idle": "Sign in"}\''],
  ["messages='not json'", "messages='{}'"],
])(
  "an invalid attribute (%s) renders an inert placeholder until it is fixed",
  async (bad, good) => {
    fakes();
    const element = await mount(`<pubky-passport ${bad}></pubky-passport>`);
    expect(element.shadowRoot!.textContent).toBe("Passport button not configured");
    const [name, value] = good.split("=") as [string, string];
    element.setAttribute(name, value.slice(1, -1));
    await flush();
    expect(button(element)).toBeDefined();
    expect(button(element)).toHaveTextContent(/Sign in|Continue with Pubky/u);
  },
);

test("the messages attribute replaces texts; the property takes its place", async () => {
  fakes();
  const element = await mount(
    '<pubky-passport messages=\'{"label.idle": "Sign in with Pubky"}\'></pubky-passport>',
  );
  expect(button(element)).toHaveTextContent("Sign in with Pubky");
  element.messages = { "label.idle": "Anmelden" };
  await flush();
  expect(button(element)).toHaveTextContent("Anmelden");
});

test("one field checks the address as it is typed and uses it with the check mark", async () => {
  const { current } = fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  const input = root.querySelector<HTMLInputElement>('[data-slot="picker-input"]')!;
  expect(root.querySelector('[part="settings"]')).toHaveAttribute("aria-expanded", "true");
  // Opening the settings puts the cursor in the address field, which suggests today's Passport.
  expect(root.activeElement).toBe(input);
  expect(input.placeholder).toBe("passport.example");
  const accept = root.querySelector<HTMLButtonElement>('[data-slot="picker-submit"]')!;
  const hint = root.querySelector('[data-slot="picker-hint"]')!;
  // No Continue or Cancel: the check mark at the end of the field, usable once the address is.
  expect(accept).toHaveAttribute("aria-label", "Use this Passport");
  expect(accept).toBeDisabled();
  expect(root.querySelector('[part="tray"] [data-slot="action"]')).toBeNull();
  input.value = "http://insecure.example";
  input.dispatchEvent(new Event("input"));
  expect(accept).toBeDisabled();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(hint.textContent).not.toBe("");
  input.value = "custom.example";
  input.dispatchEvent(new Event("input"));
  expect(accept).toBeEnabled();
  expect(input).toHaveAttribute("aria-invalid", "false");
  expect(hint).toHaveTextContent("Sign-ins from this app will open custom.example");
  accept.click();
  await flush();
  // Used at once: the popover closes.
  expect(root.querySelector('[data-slot="picker"]')).toBeNull();
  expect(current().getInstance().origin).toBe("https://custom.example");
  // The chosen Passport shows on the button's hover text and in its settings, never as a line.
  expect(root.querySelector('[data-slot="pill"]')).toHaveAttribute(
    "title",
    "Using Passport at custom.example",
  );
  // Reopened, the field holds the chosen Passport and its end resets to the app's own.
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  const field = root.querySelector<HTMLInputElement>('[data-slot="picker-input"]')!;
  const end = root.querySelector<HTMLButtonElement>('[data-slot="picker-submit"]')!;
  expect(field.value).toBe("custom.example");
  expect(end).toHaveAttribute("aria-label", "Reset to passport.example");
  expect(end).toBeEnabled();
  expect(root.querySelector('[data-slot="picker-hint"]')).toHaveTextContent(
    "Using Passport at custom.example",
  );
  // Changing the address turns the cross back into the check mark; undoing it, back again.
  field.value = "other.example";
  field.dispatchEvent(new Event("input"));
  expect(end).toHaveAttribute("aria-label", "Use this Passport");
  field.value = "custom.example";
  field.dispatchEvent(new Event("input"));
  expect(end).toHaveAttribute("aria-label", "Reset to passport.example");
  end.click();
  await flush();
  expect(current().getInstance().origin).toBe("https://passport.example");
  expect(root.querySelector('[data-slot="picker"]')).toBeNull();
  expect(root.querySelector('[data-slot="pill"]')).not.toHaveAttribute("title");
});

test("a failed attempt shows its message and a retry action", async () => {
  const { current } = fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  button(element).click();
  await flush();
  expect(current().getState()).toMatchObject({
    status: "failed",
    error: { code: "popup_blocked" },
  });
  expect(element.shadowRoot!.querySelector('[data-slot="status"]')).toHaveTextContent(
    "Your browser blocked the Passport window.",
  );
});

test("a return page that belongs to another tab's sign-in says so without app code", async () => {
  window.history.replaceState(null, "", `/?pubky-passport=s.${"A".repeat(22)}`);
  fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  await flush();
  expect(element.shadowRoot!.querySelector('[data-slot="status"]')).toHaveTextContent(
    "Sign-in continues where you started it. You can close this tab.",
  );
  // The marker was scrubbed by the client when it was created.
  expect(window.location.search).toBe("");
  window.history.replaceState(null, "", "/");
});

test("a required profile that is missing asks for one and opens Passport's profile page", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { flows, current, opened } = fakes([popup.window], async () => ({ kind: "missing" }));
  const element = await mount("<pubky-passport></pubky-passport>");
  const sessions = vi.fn();
  element.addEventListener("passport-session", sessions);
  button(element).click();
  await flush();
  const session = new FakeSession();
  flows[0]!.settle(session.session);
  await flush();
  expect(current().getState()).toMatchObject({ status: "needs-profile", check: "missing" });
  expect(button(element)).toHaveTextContent("Finish your profile");
  expect(sessions).not.toHaveBeenCalled();
  button(element).click();
  expect(opened.at(-1)).toBe("https://passport.example/#profile=approved-key");
  session.session.free();
});

test("the settings control closes the picker again and is absent while a sign-in runs", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  fakes([popup.window]);
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  expect(root.querySelector('[data-slot="picker"]')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  expect(root.querySelector('[data-slot="picker"]')).toBeNull();
  button(element).click();
  await flush();
  expect(root.querySelector('[part="settings"]')).toBeNull();
});

test("the large style shows the Pubky Ring QR and no caption", async () => {
  const { flows } = fakes();
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  await flush();
  expect(flows).toHaveLength(1);
  const root = element.shadowRoot!;
  expect(root.querySelector('[part="qr"]')).not.toBeNull();
  expect(root.querySelector('[data-slot="caption"]')).toBeNull();
  expect(root.querySelector('[data-slot="divider"]')).toHaveTextContent(
    "or log in with Pubky Ring",
  );
  expect(root.querySelector('[data-slot="ring-link"]')).toHaveTextContent("Open in Pubky Ring");
});

test("a sign-in in progress opens no popover: the label and its hover text say it", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { current } = fakes([popup.window]);
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  const container = root.firstElementChild!;
  button(element).click();
  await flush();
  expect(current().getState().status).toBe("opening");
  // Only the button is in the flow of the page, and no popover opens.
  expect([...container.children].map((child) => child.getAttribute("data-slot"))).toEqual(["pill"]);
  expect(root.querySelector<HTMLElement>('[part="tray"]')!.hidden).toBe(true);
  expect(button(element)).toHaveTextContent("Opening Passport…");
  expect(root.querySelector('[data-slot="pill"]')).toHaveAttribute(
    "title",
    expect.stringContaining("Opening Passport"),
  );
  // Screen readers still hear it.
  expect(root.querySelector('[data-slot="status"]')).toHaveTextContent("Opening Passport");
  // Cancel is the cross in the settings' place on the button, a published part of its own.
  expect(root.querySelector('[part="settings"]')).toBeNull();
  const cancel = root.querySelector<HTMLButtonElement>('[data-slot="pill"] [data-slot="cancel"]')!;
  expect(cancel).toHaveAttribute("aria-label", "Cancel");
  expect(cancel).toHaveAttribute("part", "cancel");
  cancel.click();
  await flush();
  expect(current().getState()).toMatchObject({ status: "idle" });
  expect(root.querySelector('[data-slot="cancel"]')).toBeNull();
  expect(root.querySelector('[part="settings"]')).not.toBeNull();
});

test("an error opens a popover below the button with its reason and next step", async () => {
  fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  button(element).click();
  await flush();
  const tray = root.querySelector<HTMLElement>('[part="tray"]')!;
  expect(tray.hidden).toBe(false);
  expect(tray.querySelector('[data-slot="message"]')).toHaveTextContent(
    "Your browser blocked the Passport window.",
  );
  // Escape closes it; the button still offers the way on.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(tray.hidden).toBe(true);
});

test("a click outside closes the settings popover", async () => {
  fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  expect(root.querySelector('[part="tray"] [data-slot="picker"]')).not.toBeNull();
  // Inside the element nothing closes it.
  root
    .querySelector('[data-slot="picker-input"]')!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  expect(root.querySelector('[part="tray"] [data-slot="picker"]')).not.toBeNull();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  expect(root.querySelector('[part="tray"] [data-slot="picker"]')).toBeNull();
  expect(root.querySelector('[part="settings"]')).toHaveAttribute("aria-expanded", "false");
});

test("Enter uses a valid address and ignores an invalid one", async () => {
  const { current } = fakes();
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  const input = root.querySelector<HTMLInputElement>('[data-slot="picker-input"]')!;
  const form = root.querySelector<HTMLFormElement>('[data-slot="picker"]')!;
  input.value = "not a passport";
  input.dispatchEvent(new Event("input"));
  form.requestSubmit();
  expect(root.querySelector('[data-slot="picker"]')).not.toBeNull();
  expect(current().getInstance().origin).toBe("https://passport.example");
  input.value = "other.example";
  input.dispatchEvent(new Event("input"));
  form.requestSubmit();
  await flush();
  expect(current().getInstance().origin).toBe("https://other.example");
  expect(root.querySelector('[data-slot="picker"]')).toBeNull();
});

test("the large style takes one Ring lease, even though preparing renders again at once", async () => {
  const { current, clock } = fakes();
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  await flush();
  const client = current();
  expect(client.getState().status).toBe("ready");
  // Switching to the small style releases the one lease; with no lease left, the prepared flow
  // is dropped after the lease grace. A leaked second lease would keep it ready.
  element.setAttribute("variant", "small");
  await flush();
  clock.advance(1000);
  await flush();
  expect(client.getState().status).toBe("idle");
});

test("focus stays on the button across state changes, and in the field while typing", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { current } = fakes([popup.window]);
  const element = await mount("<pubky-passport></pubky-passport>");
  const root = element.shadowRoot!;
  button(element).focus();
  expect(root.activeElement).toBe(button(element));
  button(element).click();
  await flush();
  expect(current().getState().status).toBe("opening");
  expect(root.activeElement).toBe(button(element));
  // The settings field keeps focus and the cursor when a render lands mid-typing.
  current().cancel();
  await flush();
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  const input = root.querySelector<HTMLInputElement>('[data-slot="picker-input"]')!;
  input.value = "custom.example";
  input.setSelectionRange(3, 3);
  input.dispatchEvent(new Event("input"));
  current().reset();
  await flush();
  const again = root.querySelector<HTMLInputElement>('[data-slot="picker-input"]')!;
  expect(root.activeElement).toBe(again);
  expect(again.value).toBe("custom.example");
  expect(again.selectionStart).toBe(3);
});

test("moving the element in the DOM keeps its client and a sign-in in progress", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { current } = fakes([popup.window]);
  const element = await mount("<pubky-passport></pubky-passport>");
  const client = current();
  button(element).click();
  await flush();
  expect(client.getState().status).toBe("opening");
  const other = document.createElement("div");
  document.body.append(other);
  other.append(element);
  await flush();
  expect(current()).toBe(client);
  expect(client.getState().status).toBe("opening");
  // A configuration change still rebuilds it.
  element.setAttribute("app-name", "Renamed");
  await flush();
  expect(current()).not.toBe(client);
});

/** Pins the shadow-DOM lookups the tests below share. */
const qr = (element: PassportButtonElement) =>
  element.shadowRoot!.querySelector<HTMLElement>('[part="qr"]');
const press = (element: PassportButtonElement) =>
  qr(element)!.querySelector<HTMLButtonElement>('[data-slot="qr-press"]')!;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const clipboard = { writeText: vi.fn(writeText) };
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: clipboard });
  cleanups.push(async () => {
    Reflect.deleteProperty(window.navigator, "clipboard");
  });
  return clipboard;
}

test("only the published parts carry a part name", async () => {
  fakes();
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  const root = element.shadowRoot!;
  root.querySelector<HTMLButtonElement>('[part="settings"]')!.click();
  const parts = new Set(
    [...root.querySelectorAll("[part]")].map((node) => node.getAttribute("part")),
  );
  expect([...parts].sort()).toEqual(["button", "qr", "settings", "tray"]);
});

test("pressing the code copies exactly the encoded link, announces it, and shows only a failure", async () => {
  const { flows } = fakes();
  const clipboard = stubClipboard(async () => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanups.push(async () => {
    vi.useRealTimers();
  });
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  expect(qr(element)).toHaveAttribute("data-state", "ready");
  expect(press(element)).toHaveAttribute("aria-label", "Copy authentication link");
  press(element).click();
  await flush();
  expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(flows[0]!.url);
  const note = () => element.shadowRoot!.querySelector('[data-slot="qr-note"]');
  const live = element.shadowRoot!.querySelector('[role="status"]');
  // A copy shows no line on the page; the press feedback is the code's, and screen readers hear it.
  expect(note()).toBeNull();
  expect(live).toHaveTextContent("Link copied");
  // The link itself is never written into the page.
  expect(element.shadowRoot!.innerHTML).not.toContain("secret=");
  vi.advanceTimersByTime(2000);
  expect(live!.textContent).toBe("");
  clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
  press(element).click();
  await flush();
  expect(note()).toHaveTextContent("Could not copy");
  expect(live).toHaveTextContent("Could not copy");
  vi.advanceTimersByTime(2000);
  expect(note()).toBeNull();
});

test("an expired code is blurred, never encodes the old link, and a press loads a fresh one", async () => {
  const { flows, clock, current } = fakes();
  const clipboard = stubClipboard(async () => {});
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  // A hidden page cannot rotate the code, so it expires in place.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  cleanups.push(async () => {
    Reflect.deleteProperty(document, "visibilityState");
  });
  document.dispatchEvent(new Event("visibilitychange"));
  clock.advance(300_000);
  await flush();
  expect(current().getState()).toMatchObject({ status: "ready", expired: true });
  expect(qr(element)).toHaveAttribute("data-state", "expired");
  expect(qr(element)).toHaveTextContent("Click to reload");
  expect(press(element)).toHaveAttribute("aria-label", "Reload QR code");
  expect(element.shadowRoot!.querySelector('[data-slot="ring-link"]')).toBeNull();
  press(element).click();
  await flush();
  expect(clipboard.writeText).not.toHaveBeenCalled();
  expect(flows).toHaveLength(2);
  expect(current().getState()).toMatchObject({ status: "ready" });
  expect(current().getState()).not.toHaveProperty("expired");
  expect(qr(element)).toHaveAttribute("data-state", "ready");
  press(element).click();
  await flush();
  expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(flows[1]!.url);
});

test("a Ring request that stopped working shows the expired tile, and a press retries at once", async () => {
  const { flows, current } = fakes();
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  flows[0]!.fail(new Error("relay"));
  await flush();
  // Without the press, the next attempt would wait for the retry delay.
  expect(current().getState()).toMatchObject({ status: "idle", lastError: { code: "internal" } });
  expect(qr(element)).toHaveAttribute("data-state", "expired");
  press(element).click();
  await flush();
  expect(flows).toHaveLength(2);
  expect(qr(element)).toHaveAttribute("data-state", "ready");
});

test("the divider shows only above Ring content", async () => {
  const popup = new FakePopupWindow();
  popup.documentAllowed = true;
  const { flows } = fakes([popup.window], async () => ({ kind: "missing" }));
  const element = await mount('<pubky-passport variant="large"></pubky-passport>');
  const divider = () => element.shadowRoot!.querySelector('[data-slot="divider"]');
  expect(divider()).toHaveTextContent("or log in with Pubky Ring");
  button(element).click();
  await flush();
  const session = new FakeSession();
  flows[0]!.settle(session.session);
  await flush();
  expect(button(element)).toHaveTextContent("Finish your profile");
  expect(qr(element)).toBeNull();
  expect(divider()).toBeNull();
  session.session.free();
});

describe("sync-group", () => {
  const GROUP = 'sync-group="pubky.app" instance="https://passport.example" app-name="Example"';
  const cancelOf = (element: PassportButtonElement) =>
    element.shadowRoot!.querySelector<HTMLButtonElement>('[part="cancel"]');

  test("members with one configuration share one client, its lifecycle and its cancel", async () => {
    const popup = new FakePopupWindow();
    popup.documentAllowed = true;
    const { created } = fakes([popup.window]);
    const hero = await mount(`<pubky-passport ${GROUP} variant="large"></pubky-passport>`);
    const header = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const footer = await mount(
      `<pubky-passport ${GROUP} messages='{"label.idle":"Log in"}'></pubky-passport>`,
    );
    // Style and texts may differ; the configuration is the same, so the client is too.
    expect(created).toHaveLength(1);
    expect(button(footer)).toHaveTextContent("Log in");
    button(hero).click();
    await flush();
    for (const member of [hero, header, footer]) {
      expect(button(member)).toHaveAttribute("aria-busy", "true");
      expect(cancelOf(member)).not.toBeNull();
    }
    // Cancelling from the footer cancels for everyone; the large member's code is ready again.
    cancelOf(footer)!.click();
    await flush();
    expect(created[0]!.getState().status).toBe("ready");
    for (const member of [hero, header, footer]) expect(cancelOf(member)).toBeNull();
  });

  test("removing a member keeps the attempt; the last one to leave disposes the client", async () => {
    const popup = new FakePopupWindow();
    popup.documentAllowed = true;
    const { created } = fakes([popup.window]);
    const hero = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const header = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    button(header).click();
    await flush();
    const client = created[0]!;
    const dispose = vi.spyOn(client, "dispose");
    // The scroll-revealed header unmounts mid-sign-in.
    header.parentElement!.remove();
    await flush();
    expect(dispose).not.toHaveBeenCalled();
    expect(client.getState().status).toBe("opening");
    expect(button(hero)).toHaveAttribute("aria-busy", "true");
    // Added again with the same configuration, it shows the running attempt.
    const again = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    expect(created).toHaveLength(1);
    expect(button(again)).toHaveAttribute("aria-busy", "true");
    hero.parentElement!.remove();
    again.parentElement!.remove();
    await flush();
    expect(dispose).toHaveBeenCalledOnce();
    // A new member starts a new group.
    await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    expect(created).toHaveLength(2);
  });

  test("a completed sign-in fires passport-session once, on the first member still on the page", async () => {
    const popup = new FakePopupWindow();
    popup.documentAllowed = true;
    const { flows } = fakes([popup.window]);
    const hero = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const header = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const footer = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const onDocument = vi.fn();
    document.addEventListener("passport-session", onDocument);
    const targets: EventTarget[] = [];
    for (const member of [hero, header, footer])
      member.addEventListener("passport-session", (event) => targets.push(event.target!));
    button(footer).click();
    await flush();
    // The first member leaves before the Session arrives: the next one announces it.
    hero.parentElement!.remove();
    await flush();
    const session = new FakeSession();
    flows[0]!.settle(session.session);
    await flush();
    document.removeEventListener("passport-session", onDocument);
    expect(onDocument).toHaveBeenCalledOnce();
    expect(targets).toEqual([header]);
    expect((onDocument.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      session: session.session,
      publicKey: "approved-key",
      instance: "https://passport.example",
    });
    // Signed in, every member renders nothing; reset() on any of them brings all back.
    for (const member of [header, footer])
      expect(member.shadowRoot!.querySelector('[part="button"]')).toBeNull();
    footer.reset();
    await flush();
    for (const member of [header, footer])
      expect(button(member)).toHaveTextContent("Continue with Pubky");
    session.session.free();
  });

  test("a member with another configuration is refused and leaves the group's client alone", async () => {
    const { created } = fakes();
    const hero = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    const client = created[0]!;
    const dispose = vi.spyOn(client, "dispose");
    const odd = await mount(
      `<pubky-passport ${GROUP} capabilities="/pub/example.app/:rw"></pubky-passport>`,
    );
    expect(odd.shadowRoot!.textContent).toBe("Passport button not configured");
    expect(created).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(button(hero)).toHaveTextContent("Continue with Pubky");
    // A member of the group changing its configuration is refused the same way.
    const header = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    header.setAttribute("profile", "optional");
    await flush();
    expect(header.shadowRoot!.textContent).toBe("Passport button not configured");
    expect(dispose).not.toHaveBeenCalled();
    // Fixed, it joins again.
    odd.removeAttribute("capabilities");
    await flush();
    expect(button(odd)).toHaveTextContent("Continue with Pubky");
    expect(created).toHaveLength(1);
  });

  test("a lone member rebuilds its group on a new configuration; no group keeps its own client", async () => {
    const { created } = fakes();
    const lone = await mount(`<pubky-passport ${GROUP}></pubky-passport>`);
    lone.setAttribute("capabilities", "/pub/example.app/:rw");
    await flush();
    expect(created).toHaveLength(2);
    expect(button(lone)).toHaveTextContent("Continue with Pubky");
    await mount('<pubky-passport instance="https://passport.example"></pubky-passport>');
    await mount('<pubky-passport instance="https://passport.example"></pubky-passport>');
    expect(created).toHaveLength(4);
    const long = await mount(`<pubky-passport sync-group="${"g".repeat(129)}"></pubky-passport>`);
    expect(long.shadowRoot!.textContent).toBe("Passport button not configured");
  });
});
