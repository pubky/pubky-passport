import { copyToClipboard, type CopyToasts } from "./copyToClipboard";
import { CopyIcon } from "./icons";
import { IconButton } from "./primitives/iconButton";

/**
 * Labelled read-only value, such as a pubky; `copy` adds a copy button, disabled while there is
 * nothing to copy. The value is one size with or without the button, so two keys in one place
 * always match.
 */
export function DetailField({
  copy,
  label,
  value,
}: {
  copy?: CopyToasts & { value: string | null };
  label: string;
  value: string;
}) {
  return (
    <div className="w-full min-w-0">
      <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className="flex min-w-0 items-center gap-3">
        <p className="min-w-0 flex-1 break-all text-sm font-medium leading-5">{value}</p>
        {copy ? (
          <IconButton
            aria-label={`Copy ${label}`}
            className="size-9 p-1"
            disabled={copy.value === null}
            onClick={() => {
              if (copy.value !== null) void copyToClipboard(copy.value, copy);
            }}
            variant="ghost"
          >
            <CopyIcon size={20} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
