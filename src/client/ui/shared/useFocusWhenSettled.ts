import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Moves focus to `target` when `busy` turns false while `when` holds. Work that ends by disabling
 * or replacing the control that started it (a resend that starts a cooldown, a new invoice that
 * replaces the expired one) would otherwise drop keyboard focus to the page.
 */
function useFocusWhenSettled(
  target: RefObject<HTMLElement | null>,
  busy: boolean,
  when: boolean = true,
) {
  const wasBusy = useRef(busy);
  useLayoutEffect(() => {
    const settled = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (settled && when) target.current?.focus();
  }, [busy, target, when]);
}

export { useFocusWhenSettled };
