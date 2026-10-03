export const PROFILE_PATH = "/pub/pubky.app/profile.json";
/**
 * Ring grant for profile editing, write-only: profiles and avatars are read publicly. An avatar is
 * a content-addressed blob plus a timestamped file record whose IDs are unknown when the grant is
 * requested, so those two directories are granted whole. The grant lives only in page memory and
 * is revoked when the connection is disposed.
 */
export const PROFILE_CAPABILITIES = [
  `${PROFILE_PATH}:w`,
  "/pub/pubky.app/files/:w",
  "/pub/pubky.app/blobs/:w",
] as const;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** A `PubkyAppUser` document as validated and serialised by `pubky-app-specs`. */
export type PubkyProfile = {
  name: string;
  bio?: string | null | undefined;
  image?: string | null | undefined;
  links?: { title: string; url: string }[] | null | undefined;
  status?: string | null | undefined;
};
export type LoadedProfile = { profile: PubkyProfile; avatar?: Blob | undefined };
export type ProfileIdentity = { profile?: PubkyProfile; avatarUrl?: string | undefined };
/** A re-encoded avatar: no source metadata, no local file name. */
export type PreparedAvatar = { bytes: Uint8Array; contentType: string; name: string };
/** One homeserver write of a profile publication, in the order it must be applied. */
export type ProfileWrite =
  | { kind: "bytes"; path: string; bytes: Uint8Array }
  | { kind: "json"; path: string; json: unknown };
/** Everything a save writes, built and validated before any session or grant is used. */
export type ProfilePublication = { profile: PubkyProfile; writes: readonly ProfileWrite[] };

/**
 * Whether `granted` covers every `<scope>:<actions>` entry of `required`: the same scope with at
 * least the required actions. A broader grant than requested is accepted; a narrower one is not.
 */
export function grantsCapabilities(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  const actionsByScope = new Map<string, Set<string>>();
  for (const capability of granted) {
    const parsed = parseCapability(capability);
    if (!parsed) continue;
    const actions = actionsByScope.get(parsed.scope) ?? new Set<string>();
    for (const action of parsed.actions) actions.add(action);
    actionsByScope.set(parsed.scope, actions);
  }
  return required.every((capability) => {
    const parsed = parseCapability(capability);
    if (!parsed) return false;
    const actions = actionsByScope.get(parsed.scope);
    return actions !== undefined && [...parsed.actions].every((action) => actions.has(action));
  });
}

function parseCapability(capability: string): { scope: string; actions: string } | undefined {
  const separator = capability.lastIndexOf(":");
  const scope = capability.slice(0, separator);
  const actions = capability.slice(separator + 1);
  return scope.startsWith("/") && /^(?:r|w|rw)$/.test(actions) ? { scope, actions } : undefined;
}

export function isAvatarFile(file: File): boolean {
  return file.size > 0 && file.size <= MAX_AVATAR_BYTES && AVATAR_TYPES.includes(file.type);
}

/** Identifies supported raster formats by signature; declared types and file names are not trusted. */
export function sniffImageType(bytes: Uint8Array): string | undefined {
  const matches = (signature: readonly number[], offset = 0) =>
    signature.every((value, index) => bytes[offset + index] === value);
  if (matches([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    matches([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matches([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  )
    return "image/gif";
  // "RIFF", a binary little-endian chunk size, then "WEBP".
  if (matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return undefined;
}

/**
 * Locates an avatar in its owner's own `/pub/pubky.app/` files or blobs. Remote URLs and other
 * keys' data are never fetched or rendered, so profile content cannot make Passport contact
 * third-party hosts.
 */
export function ownAvatarResource(
  publicKey: string,
  address: string,
): "files" | "blobs" | undefined {
  const match = /^pubky:\/\/([a-z0-9]{52})\/pub\/pubky\.app\/(files|blobs)\/[A-Za-z0-9]+$/.exec(
    address,
  );
  if (!match || match[1] !== publicKey) return undefined;
  return match[2] === "files" ? "files" : "blobs";
}

/**
 * The address a published profile link opens, or undefined when it is shown as text only. The
 * specs accept any scheme, `javascript:` and `data:` included, so only `http:` and `https:` links
 * open, in a new tab; `pubky:`, `mailto:` and the rest are for apps that understand them. A web
 * address carrying credentials (`https://paypal.com:login@evil.example/`) is a phishing shape, so it
 * stays text too.
 */
export function profileLinkHref(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url.username || url.password ? undefined : url.href;
}
