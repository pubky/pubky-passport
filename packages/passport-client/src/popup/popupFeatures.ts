export function popupFeatures(opener: Window): string {
  const availableHeight = number(
    () => opener.screen.availHeight,
    800,
    (value) => value > 40,
  );
  const width = 520;
  const height = Math.min(760, availableHeight - 40);
  const left =
    number(() => opener.screenX, 0) +
    (number(() => opener.outerWidth, width, positive) - width) / 2;
  const top =
    number(() => opener.screenY, 0) +
    (number(() => opener.outerHeight, height, positive) - height) / 2;
  return `popup,width=${width},height=${Math.floor(height)},left=${Math.round(left)},top=${Math.round(top)}`;
}
function positive(value: number): boolean {
  return value > 0;
}
function number(
  read: () => number,
  fallback: number,
  accepts: (value: number) => boolean = () => true,
): number {
  try {
    const value = read();
    return Number.isFinite(value) && accepts(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
