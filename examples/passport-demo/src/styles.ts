/**
 * The style gallery: live buttons, each with the code that makes it. Every one signs in with the
 * playground's options (settings.ts); the gallery only adds looks and words.
 */
import type { PassportView } from "@pubky/passport-client";
import type { PassportElement } from "@pubky/passport-client/element";
import { h } from "./dom";
import { elementAttributes, type PlaygroundSettings } from "./settings";

interface ElementStyle {
  title: string;
  hint: string;
  /** Attributes beyond the ones every button here shares (see settings.ts). */
  attributes: Record<string, string>;
  /** CSS for the tag, with the class it uses. */
  look?: { className: string; css: string };
}

// Colour and size through the element's CSS custom properties; the gallery injects this CSS, so
// the code shown is the code that runs.
const CUSTOM_LOOK = {
  className: "custom-look",
  css: [
    "pubky-passport.custom-look {",
    "  --passport-brand: #7dd3fc;",
    "  --passport-height: 52px;",
    "}",
  ].join("\n"),
};

const ELEMENT_STYLES: ElementStyle[] = [
  {
    title: "Simple",
    hint: "The tag with its options, nothing else.",
    attributes: {},
  },
  {
    title: "With the Pubky Ring QR",
    hint: 'variant="large" adds a QR code for Pubky Ring, and on phones a link that opens it.',
    attributes: { variant: "large" },
  },
  {
    title: "Your own words",
    hint: "messages replaces any text, here the button's label.",
    attributes: { messages: JSON.stringify({ "label.idle": "Log in with Pubky" }) },
  },
  {
    title: "Your colours and size",
    hint: "CSS custom properties on the tag set its colour and height.",
    attributes: {},
    look: CUSTOM_LOOK,
  },
  {
    title: "QR with your words and colours",
    hint: "The options combine: the large style, new texts and a new colour.",
    attributes: {
      variant: "large",
      messages: JSON.stringify({
        "label.idle": "Sign in",
        "ring.open": "Open Pubky Ring",
      }),
    },
    look: CUSTOM_LOOK,
  },
];

const BUTTON_CODE = [
  'import { createPassportClient } from "@pubky/passport-client";',
  "",
  "const client = createPassportClient(options);",
  "let signedIn;",
  "client.subscribe((view) => {",
  "  button.textContent = view.label;",
  '  button.setAttribute("aria-busy", String(view.busy));',
  '  status.textContent = view.status ?? "";',
  "  // The view keeps signedIn until reset(); take it once.",
  "  if (view.signedIn && !signedIn) {",
  "    signedIn = view.signedIn;",
  "    keepSignIn(signedIn);",
  "  }",
  "});",
  "button.onclick = () => client.signIn();",
].join("\n");

const LINK_CODE = [
  "client.subscribe((view) => {",
  "  link.textContent = view.label;",
  '  note.textContent = view.status ?? "";',
  "});",
  "link.onclick = () => client.signIn();",
].join("\n");

export interface StyleGallery {
  section: HTMLElement;
  /** The gallery's elements, for the page's passport-session listener, hiding and reset(). */
  elements: PassportElement[];
  /** The headless examples' own controls, hidden like the elements once signed in. */
  controls: HTMLElement[];
  /** Writes each example's code for the current options. */
  renderCode(settings: PlaygroundSettings): void;
  /** Draws the headless examples from the client's view. */
  renderHeadless(view: PassportView): void;
}

/** `signIn` is the headless client's, called from the text link's click. */
export function createStyleGallery(signIn: () => void): StyleGallery {
  const elements: PassportElement[] = [];
  const codes: { code: HTMLElement; style: ElementStyle }[] = [];
  const cards = ELEMENT_STYLES.map((style) => {
    const element = document.createElement("pubky-passport");
    for (const [name, value] of Object.entries(style.attributes)) element.setAttribute(name, value);
    if (style.look) element.classList.add(style.look.className);
    elements.push(element);
    const code = h("pre", { class: "mono", tabindex: "0" });
    codes.push({ code, style });
    return card(style.title, style.hint, element, code);
  });
  // Your own markup, driven by the headless client: first a button, then just a link.
  const button = h("button", { type: "button", class: "own-button" });
  const status = h("p", { class: "status", role: "status" });
  const link = h("button", { type: "button", class: "text-link" });
  // The button's status line is the page's live region; this one stays quiet.
  const note = h("p", { class: "status" });
  for (const control of [button, link]) control.addEventListener("click", signIn);
  cards.unshift(
    card(
      "Your own button",
      "Your markup and design, driven by the headless client: subscribe(), describe() and signIn().",
      h("div", { class: "live" }, button, status),
      h("pre", { class: "mono", tabindex: "0" }, BUTTON_CODE),
    ),
  );
  cards.push(
    card(
      "A text link",
      "The same headless client behind a plain link.",
      h("div", { class: "live" }, link, note),
      h("pre", { class: "mono", tabindex: "0" }, LINK_CODE),
    ),
  );
  return {
    section: h(
      "section",
      { class: "panel wide", "aria-labelledby": "styles-title" },
      h("style", {}, CUSTOM_LOOK.css),
      h("h2", { id: "styles-title" }, "Styles"),
      h(
        "p",
        { class: "hint" },
        "Every example signs in for real, with the playground's Passport and profile setting.",
      ),
      h("div", { class: "styles" }, ...cards),
    ),
    elements,
    controls: [button, link],
    renderCode(settings) {
      const common = elementAttributes(settings).map(([name, value]) => `${name}="${value}"`);
      for (const { code, style } of codes) {
        const extra = Object.entries(style.attributes).map(([name, value]) =>
          name === "messages" ? `messages='${value}'` : `${name}="${value}"`,
        );
        const tag = [
          "<pubky-passport",
          ...(style.look ? [`class="${style.look.className}"`] : []),
          ...common,
          ...extra,
        ].join("\n  ");
        code.textContent = [
          ...(style.look ? ["<style>", style.look.css, "</style>"] : []),
          `${tag}\n></pubky-passport>`,
        ].join("\n");
      }
    },
    renderHeadless(view) {
      for (const [control, text] of [
        [button, status],
        [link, note],
      ] as const) {
        control.textContent = view.label;
        control.setAttribute("aria-busy", String(view.busy));
        text.textContent = view.status ?? "";
        text.className = view.tone === "error" ? "status error" : "status";
      }
    },
  };
}

function card(title: string, hint: string, live: Node, code: Node): HTMLElement {
  return h(
    "div",
    { class: "style" },
    h("h3", {}, title),
    h("p", { class: "hint" }, hint),
    live,
    code,
  );
}
