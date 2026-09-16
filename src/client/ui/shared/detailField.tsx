import { CopyIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { IconButton } from "./primitives/iconButton";

export function DetailField({
  copyable = false,
  label,
  onCopy,
  value,
}: {
  copyable?: boolean;
  label: string;
  onCopy?: (() => void) | undefined;
  value: string;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p className={cn("break-all font-medium leading-6", onCopy && "md:text-sm md:leading-5")}>
          {value}
        </p>
      </div>
      {onCopy ? (
        <IconButton
          aria-label={`Copy ${label}`}
          className="size-9 p-1"
          disabled={!copyable}
          onClick={onCopy}
          variant="ghost"
        >
          <CopyIcon size={20} />
        </IconButton>
      ) : null}
    </div>
  );
}
