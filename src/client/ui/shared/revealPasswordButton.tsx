import { useLayoutEffect, useRef } from "react";

import { EyeIcon, EyeOffIcon } from "./icons";
import { IconButton } from "./primitives/iconButton";

type Caret = {
  id: string;
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | undefined;
};

/**
 * For every password field with a {@link RevealPasswordButton}: shown as text, its value must not
 * go to a spell checker or be changed by autocorrect or autocapitalization.
 */
export const REVEALABLE_PASSWORD_INPUT_PROPS = {
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "none",
} as const;

/**
 * Shows or hides what was typed into the password fields it `controls` (their ids), for a field's
 * `action` slot. Hidden by default; the pressed state says whether the text shows, so its name
 * stays "Show password" either way. Pressing it leaves focus and the caret in the field being
 * typed in: leaving the field is what checks a password, and looking at it is not leaving it.
 */
export function RevealPasswordButton({
  controls,
  onToggle,
  shown,
}: {
  controls: string;
  onToggle: () => void;
  shown: boolean;
}) {
  // Chromium moves the caret to the start when it next lays out a field whose type changed, so
  // typing on would insert before what was typed. The commit that changes the type lays the field
  // out at once, so that reset is over, and then puts the caret back.
  const caret = useRef<Caret>(null);
  useLayoutEffect(() => {
    const kept = caret.current;
    caret.current = null;
    if (!kept) return;
    const field = document.getElementById(kept.id);
    if (!(field instanceof HTMLInputElement) || document.activeElement !== field) return;
    void field.offsetWidth;
    field.setSelectionRange(kept.start, kept.end, kept.direction);
  }, [shown]);

  return (
    <IconButton
      aria-controls={controls}
      aria-label="Show password"
      aria-pressed={shown}
      // A 40px target (44px by touch) whose icon stays where the field's padding put it.
      className="-mr-3"
      onClick={() => {
        const active = document.activeElement;
        caret.current =
          active instanceof HTMLInputElement && controls.split(" ").includes(active.id)
            ? {
                id: active.id,
                start: active.selectionStart,
                end: active.selectionEnd,
                direction: active.selectionDirection ?? undefined,
              }
            : null;
        onToggle();
      }}
      // A press would otherwise move focus to the button and out of the field.
      onMouseDown={(event) => event.preventDefault()}
      type="button"
      variant="ghost"
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </IconButton>
  );
}
