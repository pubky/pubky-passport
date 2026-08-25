import type {
  GoogleIdentityError,
  GoogleIdentityViewError,
} from "./GoogleIdentityController";

export function toGoogleIdentityViewError(error: GoogleIdentityError): GoogleIdentityViewError {
  // Rebuild the object so diagnostic causes never enter React state.
  return "detailCode" in error
    ? { code: error.code, detailCode: error.detailCode }
    : { code: error.code };
}
