import "client-only";

/** Safe Google account metadata retained with a browser-local Pubky identity. */
export type GoogleAccountProfile = {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
};
