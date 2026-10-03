import { h } from "./dom";

const link = (href: string, text: string) =>
  h("a", { href, target: "_blank", rel: "noopener" }, text);

/** The one snippet an app starts from, and where to read on. */
export function explainer(): HTMLElement {
  return h(
    "section",
    { class: "panel wide explainer", "aria-labelledby": "explainer-title" },
    h("h2", { id: "explainer-title" }, "Use it in your app"),
    h(
      "pre",
      { class: "mono", tabindex: "0" },
      [
        'import "@pubky/passport-client/element";',
        "",
        '<pubky-passport app-name="Example App" client-id="example.app"',
        '  capabilities="/pub/example.app/:rw"></pubky-passport>',
        "",
        'button.addEventListener("passport-session", (event) => {',
        "  const { session, publicKey, profile } = event.detail; // session: your SDK Session",
        "});",
      ].join("\n"),
    ),
    h(
      "p",
      {},
      "The ",
      link("/integration.md", "integration guide"),
      " walks through it, and the ",
      link("/package-readme.md", "package README"),
      " is the reference. This page's own integration is ",
      link("/source/passport.ts", "src/passport.ts"),
      ": keep the Session for a reload, restore it, sign out.",
    ),
  );
}
