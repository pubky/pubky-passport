/** Access only the cross-origin-safe window reference and closed flag. */
export function hasLiveOpener(appWindow: Window): boolean {
  try {
    const opener = appWindow.opener as Window | null;
    return Boolean(opener && !opener.closed);
  } catch {
    return false;
  }
}
