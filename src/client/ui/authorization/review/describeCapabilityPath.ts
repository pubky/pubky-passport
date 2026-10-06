import { capabilityReach } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";

/**
 * Folders of the Pubky App (`/pub/pubky.app/`, the pubky-app-specs layout) that a person knows by
 * what is in them: the title for the whole folder, and for a path inside it.
 */
const PUBKY_APP_FOLDERS: Readonly<Record<string, readonly [whole: string, part: string]>> = {
  "posts/": ["Your posts", "Some of your posts"],
  "files/": ["Your files", "Some of your files"],
  "blobs/": ["Your file contents", "Some of your file contents"],
  "tags/": ["Your tags", "Some of your tags"],
  "bookmarks/": ["Your bookmarks", "Some of your bookmarks"],
  "feeds/": ["Your feeds", "Some of your feeds"],
  "follows/": ["Who you follow", "Some of your follows"],
  "mutes/": ["Who you mute", "Some of your mutes"],
};

const PUBKY_APP = "/pub/pubky.app/";

/**
 * Namespaces people know by the product that keeps them, not by their folder name: Pubky's social
 * data (the Pubky App's public folder, its v1 `/pub/social/`, and the private `/priv/social/`) and
 * Locks, the Pubky App's private content shared only with paying or approved people, which is its
 * own product and never called social data.
 */
const KNOWN_NAMESPACES: readonly {
  prefix: string;
  whole: string;
  part: string;
  description: string;
}[] = [
  {
    prefix: PUBKY_APP,
    whole: "Your public Pubky social data",
    part: "Part of your public Pubky social data",
    description: "Profile, posts, tags and follows",
  },
  {
    prefix: "/pub/social/",
    whole: "Your public Pubky social data",
    part: "Part of your public Pubky social data",
    description: "Profile, posts, tags and follows",
  },
  {
    prefix: "/priv/social/",
    whole: "Your private Pubky social data",
    part: "Part of your private Pubky social data",
    description: "Drafts, bookmarks and mutes",
  },
  {
    prefix: "/priv/app.locks/",
    whole: "Your Locks content",
    part: "Part of your Locks content",
    description: "Private content you share only with paying or approved people",
  },
];

/**
 * A plain title for a requested capability. `folder` names the app folder the path is in, as the
 * request spells it: it is shown isolated and quoted after `text`, never inside the sentence, so a
 * name with spaces or right-to-left letters cannot read as Passport's own words. `description`
 * says what a known namespace holds, on a line of its own.
 */
export type CapabilityTitle = {
  text: string;
  folder?: string | undefined;
  description?: string | undefined;
};

/**
 * A plain title for a requested capability path, so a person can tell their profile from their
 * contacts, and the requesting app's own folder (`/pub/<callbackHost>/`) from the folders other
 * apps keep. The exact path is still shown beside it: the title is a reading aid, never a
 * replacement for what is granted.
 */
export function describeCapabilityPath(path: string, callbackHost?: string): CapabilityTitle {
  // `/pub` and `/priv` without their slash reach as far as `/pub/` and `/priv/`, and `/p` as `/`.
  const reach = capabilityReach(path);
  if (reach === "all") return { text: "All your data" };
  if (reach === "public") return { text: "All your public data" };
  if (reach === "private") return { text: "All your private data" };
  // The Pubky App's own folders are known by what is in them.
  const pubkyApp = path.startsWith(PUBKY_APP)
    ? describePubkyAppPath(path.slice(PUBKY_APP.length))
    : undefined;
  if (pubkyApp) return { text: pubkyApp };
  const known = KNOWN_NAMESPACES.find(({ prefix }) => path.startsWith(prefix));
  if (known)
    return {
      text: path === known.prefix ? known.whole : known.part,
      description: known.description,
    };
  const folder = appFolder(path);
  if (!folder) {
    if (path.startsWith("/pub/")) return { text: "A public file" };
    if (path.startsWith("/priv/")) return { text: "A private file" };
    return { text: "Other data" };
  }
  const { name, whole } = folder;
  const kind = folder.side === "private" ? "private data" : "data";
  if (name === callbackHost)
    return { text: whole ? `This app's own ${kind}` : `Some of this app's own ${kind}` };
  // Without a website the request cannot say which folder is its own.
  const owner = callbackHost === undefined ? "an app's" : "another app's";
  return {
    text: whole ? `${capitalize(owner)} ${kind}` : `Some of ${owner} ${kind}`,
    folder: name,
  };
}

/**
 * Whether a path stays inside the requesting app's own public folder, `/pub/<callbackHost>/`: the
 * only rows a long list may fold away. Without a callback host no folder is known to be its own.
 */
export function isOwnPublicFolder(path: string, callbackHost: string | undefined): boolean {
  return callbackHost !== undefined && path.startsWith(`/pub/${callbackHost}/`);
}

/** A known folder of the Pubky App's public data; `undefined` for the whole or any other part. */
function describePubkyAppPath(rest: string): string | undefined {
  if (rest === "profile.json") return "Your public profile";
  for (const [folder, [whole, part]] of Object.entries(PUBKY_APP_FOLDERS)) {
    if (rest === folder) return whole;
    if (rest.startsWith(folder)) return part;
  }
  return undefined;
}

/** The app folder a path is in, named by its first segment (usually the app's own domain). */
function appFolder(
  path: string,
): { name: string; side: "public" | "private"; whole: boolean } | undefined {
  const side = path.startsWith("/pub/") ? "public" : path.startsWith("/priv/") ? "private" : null;
  if (!side) return undefined;
  const rest = path.slice(side === "public" ? "/pub/".length : "/priv/".length);
  const separator = rest.indexOf("/");
  if (separator === -1) return undefined;
  return { name: rest.slice(0, separator), side, whole: separator === rest.length - 1 };
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
