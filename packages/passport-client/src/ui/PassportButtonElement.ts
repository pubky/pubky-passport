import type { PassportState } from "../attempt/attemptModel.js";
import { createInternalClient } from "../client/createPassportClient.js";
import type { InternalClient, PreparedLease } from "../client/InternalClient.js";
import type { SignedIn } from "../client/PassportClient.js";
import type { InternalClientOptions } from "../config/PassportClientOptions.js";
import { PassportConfigError } from "../config/PassportConfigError.js";
import type { PassportAction } from "../errors/PassportError.js";
import { formatMessage } from "../errors/formatMessage.js";
import type { MessageKey, PassportMessageOverrides } from "../errors/messageTypes.js";
import { validateInstanceOrigin } from "../instance/instanceOrigin.js";
import { fitsPassportQr } from "../qrcode/fitsPassportQr.js";
import { renderQrSvg } from "../qrcode/renderQrSvg.js";
import type { RingLink } from "../shared/RingLink.js";
import { describePassportState, type ButtonView } from "../view/describeState.js";
import {
  addRingLogo,
  createCheckIcon,
  createCrossIcon,
  createPassportMark,
  createSettingsIcon,
} from "./passportMark.js";
import { adoptPassportStyles } from "./passportStyles.js";
import { syncGroups } from "./syncGroups.js";
import { Tray } from "./Tray.js";

/** The attributes the client is built from; `messages` only changes texts. */
const CLIENT_ATTRIBUTES = [
  "app-name",
  "capabilities",
  "client-id",
  "instance",
  "profile",
  "network",
  "pkarr-relays",
  "http-relay",
] as const;
/** The published style hooks; everything else is internal and found by `data-slot`. */
const PARTS = new Set(["button", "settings", "cancel", "qr"]);
/** A `sync-group` name: trimmed, at most this long; empty means no group. */
const MAX_SYNC_GROUP = 128;
const QR_STATES = new Set<PassportState["status"]>(["ready", "opening", "waiting"]);
/** The Passport can change only while no sign-in runs. */
const PICKER_STATES = new Set<PassportState["status"]>(["idle", "preparing", "ready", "failed"]);
/** How long a copy is announced, or its failure shown under the code. */
const COPY_NOTE_MS = 2_000;
const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;

type ClientFactory = (options: InternalClientOptions) => InternalClient;
let clientFactory: ClientFactory = createInternalClient;

/** Internal test seam: the unit tests build the element's client on fake browser and SDK ports. */
export function setElementClientFactory(factory: ClientFactory | undefined): void {
  clientFactory = factory ?? createInternalClient;
}

/** The detail of `passport-session`: the app owns the Session. */
export type PassportSessionEvent = CustomEvent<SignedIn>;

/**
 * `<pubky-passport>`: a sign-in button with its own client, configured by its attributes. It
 * renders nothing once signed in; `reset()` brings it back after the app signed out.
 */
export class PassportButtonElement extends HTMLElementBase {
  static readonly observedAttributes = [...CLIENT_ATTRIBUTES, "sync-group", "messages", "variant"];
  #messages: PassportMessageOverrides | undefined;
  /** The `messages` attribute, parsed when the element resolves its configuration. */
  #attributeMessages: PassportMessageOverrides | undefined;
  #client: InternalClient | undefined;
  /** The `sync-group` whose shared client this element uses, if any. */
  #group: string | undefined;
  /** The configuration the current client was built from, with its sync group. */
  #optionsKey: string | undefined;
  #release: (() => void)[] = [];
  #root: ShadowRoot | undefined;
  /** Persistent: the button and the QR render into it, and the popover sits beside it. */
  #container: HTMLDivElement | undefined;
  #tray: Tray | undefined;
  /** The status text whose popover was dismissed; a different status opens it again. */
  #dismissedStatus: string | undefined;
  /** Status for assistive technology, whether or not its popover is open. */
  #live: HTMLDivElement | undefined;
  #scheduled = false;
  #invalid = false;
  #lease: PreparedLease | undefined;
  #picker: "closed" | "open" = "closed";
  #focusPicker = false;
  #pickerValue = "";
  #pickerError = "";
  /** The QR tile: a closed root holds the code, so only this element reads the link. */
  #qrBox: HTMLDivElement | undefined;
  #qrRoot: ShadowRoot | undefined;
  #qrFor: RingLink | "expired" | undefined;
  #qrTooLarge = new WeakSet<RingLink>();
  /**
   * What the last press on the code did, for a moment: a copy is only announced (the code's press
   * feedback shows it), a failure is also shown under the code.
   */
  #copyNote: "ring.copied" | "ring.copy-failed" | undefined;
  #copyNoteTimer: ReturnType<typeof setTimeout> | undefined;
  /** This page is a same-tab return that belongs to a sign-in in another tab. */
  #stray = false;

  /** Replaces any of the built-in texts; set, it takes the place of the `messages` attribute. */
  get messages(): PassportMessageOverrides | undefined {
    return this.#messages;
  }
  set messages(value: PassportMessageOverrides | undefined) {
    this.#messages = value ?? undefined;
    this.#refresh();
  }

  /** Cancels a sign-in in progress, or shows the button again after the app signed out. */
  reset(): void {
    this.#client?.cancel();
    this.#client?.reset();
  }

  connectedCallback(): void {
    // ELM-02: properties set before the element was defined are captured at upgrade.
    if (Object.hasOwn(this, "messages")) {
      const value = (this as { messages?: PassportMessageOverrides }).messages;
      delete (this as { messages?: PassportMessageOverrides }).messages;
      this.messages = value;
    }
    if (!this.#root) {
      this.#root = this.attachShadow({ mode: "open" });
      this.#container = this.#element("div");
      this.#live = this.#element("div", undefined, "status", "sr");
      this.#live.setAttribute("role", "status");
      this.#tray = new Tray(this, () => this.#dismissTray());
      this.#root.replaceChildren(this.#container, this.#live, this.#tray.element);
    }
    this.#refresh();
  }

  disconnectedCallback(): void {
    this.#releaseLease();
    this.#tray?.hide();
    queueMicrotask(() => {
      if (!this.isConnected) this.#unbind();
    });
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next) return;
    if (name === "variant") this.#render();
    else this.#refresh();
  }

  /** Triggers within one task collapse into one resolution. */
  #refresh(): void {
    if (this.#scheduled || !this.isConnected) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.isConnected) this.#resolve();
    });
  }

  /**
   * The client is rebuilt when its configuration changes; a move in the DOM keeps it. Texts and
   * the style are not part of that configuration: changing them never restarts a sign-in. In a
   * `sync-group` the client is the group's, shared with every member of the same configuration.
   */
  #resolve(): void {
    let options: InternalClientOptions;
    let client: InternalClient | undefined;
    let group: string | undefined;
    let bound: string;
    try {
      this.#attributeMessages = messagesAttribute(this.getAttribute("messages"));
      group = syncGroupAttribute(this.getAttribute("sync-group"));
      options = this.#options();
      const key = JSON.stringify(options);
      bound = JSON.stringify([group ?? null, key]);
      if (this.#client && this.#optionsKey === bound) return this.#render();
      if (group === undefined) client = clientFactory(options);
      else {
        // Leaving first lets a lone member rebuild the group with its new configuration.
        this.#unbind();
        client = syncGroups.join(group, key, this, () => clientFactory(options));
      }
    } catch (e) {
      if (!(e instanceof PassportConfigError)) throw e;
      client = undefined;
      bound = "";
    }
    if (!client) {
      // A bad attribute, or a configuration the sync group does not share: the group's client
      // is left as it is, and this element shows that it is not configured.
      this.#unbind();
      this.#invalid = true;
      this.#render();
      return;
    }
    this.#bind(client, group);
    this.#optionsKey = bound;
  }

  #bind(client: InternalClient, group: string | undefined): void {
    this.#unbind();
    this.#invalid = false;
    this.#client = client;
    this.#group = group;
    this.#release.push(
      client.subscribe(() => this.#render()),
      client.onSession((session, info) => {
        // A shared client tells every member; only the group's first one on the page announces it.
        if (group !== undefined && syncGroups.leader(group) !== this) return;
        this.#emit("passport-session", {
          session,
          publicKey: info.publicKey,
          profile: info.profile,
          instance: info.instance,
        } satisfies SignedIn);
      }),
    );
    // The client consumed any same-tab return when it was created; this reads its result.
    this.#stray = client.handleReturn() === "stray";
    this.#render();
  }

  #unbind(): void {
    const client = this.#client;
    const group = this.#group;
    this.#client = undefined;
    this.#group = undefined;
    this.#optionsKey = undefined;
    this.#releaseLease();
    this.#tray?.hide();
    clearTimeout(this.#copyNoteTimer);
    this.#copyNote = undefined;
    for (const release of this.#release.splice(0)) release();
    // A group's client stays for its other members; the last one to leave disposes it.
    if (group !== undefined) syncGroups.leave(group, this);
    else client?.dispose();
  }

  #render(): void {
    const root = this.#root;
    const container = this.#container;
    const tray = this.#tray;
    if (!root || !container || !tray) return;
    const client = this.#client;
    if (this.#invalid || !client) {
      adoptPassportStyles(root, false);
      container.className = "";
      container.replaceChildren(
        ...(this.#invalid ? [this.#element("span", "Passport button not configured")] : []),
      );
      tray.hide();
      return;
    }
    const large = this.getAttribute("variant") === "large";
    // The Ring lease first: preparing changes the state (and renders again) before it returns.
    if (large && !this.#lease) {
      const lease = client.prepare();
      if (this.#lease) lease.release();
      else this.#lease = lease;
    }
    // What has focus is rebuilt below and given focus again, with the field's selection.
    const focused = root.activeElement;
    const focusedSlot = focused?.getAttribute("data-slot") ?? undefined;
    const selection =
      focused instanceof HTMLInputElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : undefined;
    const state = client.getState();
    const found = this.#view(client, state);
    const view =
      this.#stray && state.status === "idle" && !found.status
        ? { ...found, status: this.#text("return.stray") }
        : found;
    adoptPassportStyles(root, view.hidden);
    this.#live!.textContent = view.hidden
      ? ""
      : (view.status ?? (this.#copyNote ? this.#text(this.#copyNote) : ""));
    if (view.hidden) {
      this.#releaseLease();
      container.replaceChildren();
      tray.hide();
      this.#qrFor = undefined;
      return;
    }
    if (!large) this.#releaseLease();
    container.className = large ? "c large" : "c";
    const pill = this.#pill(client, view, state);
    container.replaceChildren(pill, ...(large ? this.#ring(client, state) : []));
    // Everything else floats below the button, so the element never grows on the page. Progress
    // needs no popover (the label says it); an error, or a return that belongs to another tab,
    // opens one by itself.
    const picker = this.#pickerNodes(client, view, state);
    const actions = popoverActions(view);
    const explain =
      view.tone === "error" ||
      actions.length > 0 ||
      (this.#stray && view.status === this.#text("return.stray"));
    if (picker) tray.show(pill, this.#text("picker.toggle"), picker);
    else if (view.status && explain && view.status !== this.#dismissedStatus)
      tray.show(pill, view.status, this.#statusNodes(client, view, actions));
    else tray.hide();
    if (!view.status) this.#dismissedStatus = undefined;
    if (this.#focusPicker) {
      this.#focusPicker = false;
      tray.element.querySelector<HTMLInputElement>('[data-slot="picker-input"]')?.focus();
    } else if (focusedSlot) {
      const again = root.querySelector<HTMLElement>(`[data-slot="${focusedSlot}"]`);
      again?.focus();
      if (again instanceof HTMLInputElement && selection)
        again.setSelectionRange(selection.start, selection.end);
    }
  }

  /** Escape or a click outside closes the popover: the settings, or the current status. */
  #dismissTray(): void {
    if (this.#picker !== "closed") {
      this.#picker = "closed";
      this.#pickerError = "";
    } else {
      const state = this.#client?.getState();
      const status = state && this.#client ? this.#view(this.#client, state).status : undefined;
      this.#dismissedStatus = this.#stray && !status ? this.#text("return.stray") : status;
    }
    this.#render();
  }

  /** The status popover: what went wrong, and what else can be done about it, on one line. */
  #statusNodes(
    client: InternalClient,
    view: ButtonView,
    actions: readonly PassportAction[],
  ): HTMLElement[] {
    const status = this.#element(
      "p",
      view.status,
      "message",
      view.tone === "error" ? "status error" : "status",
    );
    const nodes: HTMLElement[] = [status];
    if (actions.length) {
      const row = this.#element("div", undefined, "actions", "actions");
      for (const action of actions)
        row.append(this.#actionButton(client, action, view.actionLabels[action]));
      nodes.push(row);
    }
    return nodes;
  }

  /** The button and, while no sign-in runs, its settings: one pill, two controls. */
  #pill(client: InternalClient, view: ButtonView, state: PassportState): HTMLElement {
    const pill = this.#element("div", undefined, "pill", "pill");
    // Progress, or a chosen Passport, shows on hover rather than as a line on the page.
    const hover = view.status ?? view.notice;
    if (hover) pill.title = hover;
    pill.append(this.#mainButton(client, view));
    if (!PICKER_STATES.has(state.status)) {
      this.#picker = "closed";
      // While a sign-in runs, the settings' place cancels it.
      if (view.secondary.includes("cancel")) {
        const cancel = this.#element("button", undefined, "cancel", "settings");
        cancel.type = "button";
        cancel.dataset.action = "cancel";
        cancel.setAttribute("aria-label", view.actionLabels.cancel);
        cancel.title = view.actionLabels.cancel;
        cancel.append(createCrossIcon(this.ownerDocument));
        cancel.addEventListener("click", () => client.perform("cancel"));
        pill.append(cancel);
      }
      return pill;
    }
    const settings = this.#element("button", undefined, "settings", "settings");
    settings.type = "button";
    const label = this.#text("picker.toggle");
    settings.setAttribute("aria-label", label);
    settings.title = label;
    settings.setAttribute("aria-expanded", String(this.#picker !== "closed"));
    settings.append(createSettingsIcon(this.ownerDocument));
    settings.addEventListener("click", () => {
      const opening = this.#picker === "closed";
      this.#picker = opening ? "open" : "closed";
      this.#pickerError = "";
      // A Passport the person chose shows in the field, ready to change or reset.
      if (opening) this.#pickerValue = state.instance.isCustom ? state.instance.host : "";
      this.#focusPicker = opening;
      this.#render();
    });
    pill.append(settings);
    return pill;
  }

  #mainButton(client: InternalClient, view: ButtonView): HTMLButtonElement {
    const button = this.#element("button", undefined, "button", "main");
    button.type = "button";
    button.setAttribute("aria-busy", String(view.busy));
    if (!view.primary) button.setAttribute("aria-disabled", "true");
    const row = this.#element("span", undefined, undefined, "row");
    row.append(createPassportMark(this.ownerDocument), this.#element("span", view.label, "label"));
    button.append(row);
    // POP-01/POP-13: act synchronously in the click; an unavailable action stays focusable.
    button.addEventListener("click", () => {
      const current = this.#view(client, client.getState());
      if (current.primary) client.perform(current.primary);
    });
    return button;
  }

  #actionButton(client: InternalClient, action: PassportAction, label: string): HTMLButtonElement {
    const button = this.#element("button", label, "action", "second");
    button.type = "button";
    button.dataset.action = action;
    button.addEventListener("click", () => client.perform(action));
    return button;
  }

  /**
   * The large style's Pubky Ring part: the live request's code (pressing it copies the link) and,
   * on a phone, a button that opens Pubky Ring with it. A request that can no longer be used shows
   * a blurred stand-in that asks for a fresh one; the divider shows only above something.
   */
  #ring(client: InternalClient, state: PassportState): HTMLElement[] {
    const link = QR_STATES.has(state.status) && "ringLink" in state ? state.ringLink : undefined;
    const url = state.status === "ready" && state.expired ? undefined : link?.reveal();
    const nodes: HTMLElement[] = [];
    if (url) {
      const qr = this.#qr(link!, url);
      if (qr) nodes.push(qr);
      if (this.#copyNote === "ring.copy-failed")
        nodes.push(this.#element("p", this.#text(this.#copyNote), "qr-note", "caption"));
      const open = this.#element("button", this.#text("ring.open"), "ring-link", "second ring");
      open.type = "button";
      open.addEventListener("click", () => {
        this.#lease?.ringOpened();
        const target = link!.reveal();
        if (target) this.ownerDocument.defaultView?.location.assign(target);
      });
      nodes.push(open);
    } else if (spent(state)) nodes.push(this.#expired(client));
    else {
      this.#qrFor = undefined;
      if (state.status === "preparing" || state.status === "idle")
        nodes.push(this.#element("div", this.#text("ring.preparing"), "caption", "caption"));
    }
    if (!nodes.length) return [];
    return [this.#element("div", this.#text("ring.divider"), "divider", "divider"), ...nodes];
  }

  /** The QR lives in a closed root; only this element and the deep-link button reveal the link. */
  #qr(link: RingLink, url: string): HTMLElement | undefined {
    if (this.#qrTooLarge.has(link)) return undefined;
    const box = this.#qrTile("ready");
    if (this.#qrFor !== link) {
      if (!fitsPassportQr(url)) return this.#tooLarge(link);
      const label = this.#text("ring.qr-label");
      let svg: SVGSVGElement;
      try {
        // Pubky Ring's logo covers the centre, which the H error correction restores; a link too
        // long for H is drawn plain.
        svg = addRingLogo(renderQrSvg(url, { label, ecc: "H", border: 0 }));
      } catch {
        try {
          svg = renderQrSvg(url, { label, border: 0 });
        } catch {
          return this.#tooLarge(link);
        }
      }
      this.#qrRoot!.replaceChildren(svg);
      this.#qrFor = link;
    }
    this.#qrPress(box, "ring.copy", () => void this.#copy(link));
    return box;
  }

  /** A blurred stand-in, never the spent link: pressing it asks for a fresh request. */
  #expired(client: InternalClient): HTMLElement {
    const box = this.#qrTile("expired");
    if (this.#qrFor !== "expired") {
      const stand = renderQrSvg("pubky-passport:expired", { ecc: "L", border: 0 });
      stand.setAttribute("aria-hidden", "true");
      stand.removeAttribute("role");
      stand.removeAttribute("aria-label");
      this.#qrRoot!.replaceChildren(stand);
      this.#qrFor = "expired";
    }
    this.#qrPress(box, "ring.reload", () => client.reloadRing());
    box.append(this.#element("span", this.#text("ring.expired"), undefined, "tag"));
    box.lastElementChild!.setAttribute("aria-hidden", "true");
    return box;
  }

  /** The persistent tile and its closed root, emptied of its press and tag for this render. */
  #qrTile(state: "ready" | "expired"): HTMLDivElement {
    if (!this.#qrBox || !this.#qrRoot) {
      this.#qrBox = this.#element("div", undefined, "qr", "qr");
      const code = this.#element("span", undefined, "qr-code", "code");
      this.#qrRoot = code.attachShadow({ mode: "closed" });
      this.#qrBox.append(code);
    }
    this.#qrBox.dataset.state = state;
    this.#qrBox.replaceChildren(this.#qrBox.firstElementChild!);
    return this.#qrBox;
  }

  /** A button over the code, so the code keeps its own name for assistive technology. */
  #qrPress(box: HTMLDivElement, label: MessageKey, act: () => void): void {
    const press = this.#element("button", undefined, "qr-press", "press");
    press.type = "button";
    press.setAttribute("aria-label", this.#text(label));
    press.addEventListener("click", act);
    box.append(press);
  }

  /** Copies exactly the link the code encodes; the link itself is never written to the page. */
  async #copy(link: RingLink): Promise<void> {
    const target = link.reveal();
    let copied = false;
    try {
      if (target) {
        await this.ownerDocument.defaultView!.navigator.clipboard.writeText(target);
        copied = true;
      }
    } catch {
      /* Said below; the browser's reason is never shown or logged. */
    }
    this.#copyNote = copied ? "ring.copied" : "ring.copy-failed";
    clearTimeout(this.#copyNoteTimer);
    this.#copyNoteTimer = setTimeout(() => {
      this.#copyNote = undefined;
      this.#render();
    }, COPY_NOTE_MS);
    this.#render();
  }

  #tooLarge(link: RingLink): undefined {
    this.#qrTooLarge.add(link);
    this.#qrRoot?.replaceChildren();
    this.#qrFor = undefined;
    return undefined;
  }

  #pickerNodes(
    client: InternalClient,
    view: ButtonView,
    state: PassportState,
  ): HTMLElement[] | undefined {
    if (!PICKER_STATES.has(state.status) || this.#picker === "closed") return undefined;
    // A Passport the person chose: the field holds it, and its end resets to the app's own.
    const custom = state.instance.isCustom ? state.instance : undefined;
    // One field: checked as it is typed, used on Enter or with the check mark at its end.
    const form = this.#element("form", undefined, "picker", "picker");
    form.noValidate = true;
    const field = this.#element("label");
    const input = this.#element("input", undefined, "picker-input");
    input.value = this.#pickerValue;
    // The Passport sign-ins open today, as the example of what to type.
    input.placeholder = client.getInstance().host;
    input.setAttribute("autocomplete", "url");
    input.setAttribute("enterkeyhint", "done");
    input.spellcheck = false;
    const accept = this.#element("button", undefined, "picker-submit", "accept");
    accept.addEventListener("click", (event) => {
      if (accept.dataset.mode !== "reset") return;
      event.preventDefault();
      client.perform("reset-instance");
      this.#picker = "closed";
      this.#pickerValue = "";
      this.#render();
    });
    // The field's end: a check mark uses the typed address; a cross drops the chosen one.
    const end = (mode: "accept" | "reset") => {
      if (accept.dataset.mode === mode) return;
      accept.dataset.mode = mode;
      accept.type = mode === "reset" ? "button" : "submit";
      const label = this.#text(mode === "reset" ? "picker.reset" : "picker.use");
      accept.setAttribute("aria-label", label);
      accept.title = label;
      accept.replaceChildren(
        mode === "reset"
          ? createCrossIcon(this.ownerDocument)
          : createCheckIcon(this.ownerDocument),
      );
    };
    const hint = this.#element("span", undefined, "picker-hint", "hint");
    hint.setAttribute("aria-live", "polite");
    const check = () => {
      const value = input.value.trim();
      const checked = value ? validateInstanceOrigin(value) : undefined;
      const valid = checked?.ok === true;
      const unchanged = custom !== undefined && valid && checked.origin === custom.origin;
      end(unchanged ? "reset" : "accept");
      accept.disabled = !valid;
      input.setAttribute("aria-invalid", String(Boolean(value) && !valid));
      hint.classList.toggle("error", Boolean(value) && !valid);
      hint.textContent = this.#pickerError
        ? this.#pickerError
        : unchanged
          ? (view.notice ?? "")
          : !value
            ? ""
            : checked?.ok
              ? this.#text("picker.confirm", new URL(checked.origin).host)
              : this.#text("instance.instance_invalid");
    };
    input.addEventListener("input", () => {
      this.#pickerValue = input.value;
      this.#pickerError = "";
      check();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validateInstanceOrigin(this.#pickerValue.trim()).ok) return check();
      const result = client.setInstance(this.#pickerValue.trim());
      this.#pickerError = result.ok
        ? ""
        : this.#text(
            result.code === "internal" ? "error.internal" : `instance.${result.code}`,
            client.getState().instance.host,
          );
      if (result.ok) {
        this.#picker = "closed";
        this.#pickerValue = "";
      }
      this.#render();
    });
    const control = this.#element("span", undefined, undefined, "field");
    control.append(input, accept);
    field.append(this.#element("span", this.#text("picker.input")), control);
    form.append(field, hint);
    check();
    if (this.#pickerError) hint.setAttribute("role", "alert");
    return [form];
  }

  /** The element's texts: the built-in ones, with `messages` (property or attribute) over them. */
  #currentMessages(): PassportMessageOverrides | undefined {
    return this.#messages ?? this.#attributeMessages;
  }

  #view(client: InternalClient, state: PassportState): ButtonView {
    return describePassportState(state, this.#currentMessages(), client.messageContext());
  }

  #text(key: MessageKey, instanceHost?: string): string {
    return formatMessage(key, this.#currentMessages(), {
      ...this.#client?.messageContext(),
      ...(instanceHost ? { instanceHost } : {}),
    });
  }

  #options(): InternalClientOptions {
    const options: Record<string, unknown> = {
      appName: this.getAttribute("app-name") ?? undefined,
      capabilities: this.getAttribute("capabilities") ?? undefined,
      clientId: this.getAttribute("client-id") ?? undefined,
      instance: this.getAttribute("instance") ?? undefined,
      profile: this.getAttribute("profile") ?? undefined,
      network: this.getAttribute("network") ?? undefined,
      pkarrRelays: this.getAttribute("pkarr-relays") ?? undefined,
      httpRelay: this.getAttribute("http-relay") ?? undefined,
    };
    for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];
    return options as InternalClientOptions;
  }

  #emit(type: string, detail: unknown): void {
    queueMicrotask(() =>
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })),
    );
  }

  #releaseLease(): void {
    const lease = this.#lease;
    this.#lease = undefined;
    lease?.release();
  }

  /**
   * `slot` names the node for the element's own lookups (`data-slot`); the published ones are
   * also the node's `part`.
   */
  #element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    slot?: string,
    className?: string,
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (slot) {
      element.dataset.slot = slot;
      if (PARTS.has(slot)) element.setAttribute("part", slot);
    }
    if (className) element.className = className;
    return element;
  }
}

/** A Ring request that can no longer be used: its code is replaced by the expired tile. */
function spent(state: PassportState): boolean {
  return (
    (state.status === "ready" && state.expired === true) ||
    state.status === "failed" ||
    (state.status === "idle" && state.lastError !== undefined)
  );
}

/** The `sync-group` attribute: a trimmed name of at most 128 characters; empty is no group. */
function syncGroupAttribute(value: string | null): string | undefined {
  const name = value?.trim() ?? "";
  if (name.length > MAX_SYNC_GROUP)
    throw new PassportConfigError([
      {
        option: "sync-group",
        code: "invalid_value",
        message: "Use a name of at most 128 characters.",
      },
    ]);
  return name || undefined;
}

/** The `messages` attribute: a JSON object of message keys to replacement texts. */
function messagesAttribute(value: string | null): PassportMessageOverrides | undefined {
  if (value === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = undefined;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((text) => typeof text !== "string")
  )
    throw new PassportConfigError([
      { option: "messages", code: "invalid_value", message: "Use a JSON object of texts." },
    ]);
  return parsed as PassportMessageOverrides;
}

/** Cancel sits on the button and resetting the Passport in the settings; the rest may float. */
function popoverActions(view: ButtonView): PassportAction[] {
  return view.secondary.filter((action) => action !== "cancel" && action !== "reset-instance");
}
