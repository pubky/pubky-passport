import "client-only";

import type { Result } from "better-result";

export type GoogleSignInCredential = {
  googleIdToken: string;
  subject: string;
};

export type GoogleSignInErrorCode = "google_unavailable" | "sign_in_failed";
export type GoogleSignInResult<T> = Result<T, { code: GoogleSignInErrorCode }>;

export type GoogleSignInButton = {
  mount(input: {
    target: HTMLElement;
    onCredential: (result: GoogleSignInResult<GoogleSignInCredential>) => void;
  }): Promise<GoogleSignInResult<void>>;
  unmount(): void;
};
