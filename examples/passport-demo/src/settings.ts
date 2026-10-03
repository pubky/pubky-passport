import type { PassportClientOptions, SignedIn } from "@pubky/passport-client";
import type { PassportElement } from "@pubky/passport-client/element";
import {
  APP_CAPABILITIES,
  APP_CLIENT_ID,
  APP_NAME,
  PASSPORT_URL,
  STORAGE_NAMESPACE,
} from "./config";

/** The playground's choices for every sign-in surface on the page, and the element's style. */
export interface PlaygroundSettings {
  /** The Passport (an https origin) people sign in with; empty for the package's own. */
  instance: string;
  /** "required": sign-in finishes only once the person has a pubky.app profile. */
  profile: "required" | "optional";
  variant: "small" | "large";
}

export const DEFAULT_SETTINGS: Readonly<PlaygroundSettings> = Object.freeze({
  instance: PASSPORT_URL ?? "",
  profile: "required",
  variant: "large",
});

/** The options every sign-in surface on the page shares: the app's identity and the choices. */
export function passportOptions(settings: PlaygroundSettings) {
  return {
    ...(settings.instance ? { instance: settings.instance } : {}),
    // Passport shows the name and ID to the person approving the sign-in.
    appName: APP_NAME,
    clientId: APP_CLIENT_ID,
    // What the Session may do on the person's homeserver: read and write this app's folder.
    capabilities: APP_CAPABILITIES,
    profile: settings.profile,
  } satisfies PassportClientOptions;
}

/** The same options as the element's attributes, as the snippets print them. */
export function elementAttributes(settings: PlaygroundSettings): [string, string][] {
  const { instance, appName, clientId, capabilities, profile } = passportOptions(settings);
  const attributes: [string, string][] = [
    ["app-name", appName],
    ["client-id", clientId],
    ["capabilities", capabilities],
  ];
  if (instance) attributes.unshift(["instance", instance]);
  // The element requires a profile unless told otherwise.
  if (profile === "optional") attributes.push(["profile", "optional"]);
  return attributes;
}

/**
 * Sets the element's attributes. Set them before the element joins the page, so a same-tab return
 * resumes with the same options.
 */
export function configureElement(element: PassportElement, settings: PlaygroundSettings): void {
  for (const name of ["instance", "profile"]) element.removeAttribute(name);
  for (const [name, value] of elementAttributes(settings)) element.setAttribute(name, value);
}

/**
 * The page's one sign-in, from whichever surface finishes first; a second Session (two buttons
 * finishing at once) is signed out and freed. `take` returns false for a Session it turns away.
 */
export function firstSignIn(show: (signedIn: SignedIn) => void) {
  let current: SignedIn | undefined;
  return {
    take(signedIn: SignedIn): boolean {
      if (current) {
        if (signedIn.session !== current.session)
          void signedIn.session
            .signout()
            .catch(() => {})
            .finally(() => signedIn.session.free());
        return false;
      }
      current = signedIn;
      show(signedIn);
      return true;
    },
    /** Ends the page's sign-in and returns it, for sign-out. */
    end(): SignedIn | undefined {
      const signedIn = current;
      current = undefined;
      return signedIn;
    },
  };
}

// v5: the default Passport is now the package's own, so older saved choices must not stick.
const KEY = `${STORAGE_NAMESPACE}:playground:v5`;

/** Kept across reloads: a same-tab return must rebuild its buttons with the options it left with. */
export function loadSettings(storage: Pick<Storage, "getItem"> = localStorage): PlaygroundSettings {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
    const record = value as Record<string, unknown>;
    return {
      instance: typeof record.instance === "string" ? record.instance : DEFAULT_SETTINGS.instance,
      profile: record.profile === "optional" ? "optional" : "required",
      variant: record.variant === "small" ? "small" : "large",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: PlaygroundSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A private window keeps the settings for this page only.
  }
}

export function clearSettings(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing was saved.
  }
}
