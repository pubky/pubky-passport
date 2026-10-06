/** A `pubky.app` profile as pubky-app-specs validates and sanitises it. */
export interface PassportProfile {
  readonly name: string;
  readonly bio?: string;
  /** A `pubky://` file URL, not a web URL: read it with the SDK. */
  readonly image?: string;
  readonly links?: readonly { readonly title: string; readonly url: string }[];
  readonly status?: string;
}

export type ProfileRead =
  { kind: "found"; profile: PassportProfile } | { kind: "missing" } | { kind: "error" };
export type ProfileDocument =
  { kind: "found"; bytes: Uint8Array } | { kind: "missing" } | { kind: "error" };
