/** Called only for a recognized return marker, after the foreign-client guard. */
export function scrubReturnUrl(url: URL, history: Pick<History, "state" | "replaceState">): void {
  try {
    const clean = new URL(url.href);
    for (const key of ["pubky-passport", "errorCode", "errorMessage"])
      clean.searchParams.delete(key);
    history.replaceState(history.state, "", clean.href);
  } catch {
    /* A consumed record stays consumed even when native history cannot be changed. */
  }
}
