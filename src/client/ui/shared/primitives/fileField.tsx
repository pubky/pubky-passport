import { type ComponentPropsWithRef, useState } from "react";

import { FileTextIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";

/**
 * A file picker that looks like the other fields instead of the browser's unstyled input. The
 * native input lies invisibly over the whole box, so a click or a drop anywhere in it picks a
 * file, and it stays the only control assistive technology meets: the page's label names it and
 * the browser announces the chosen file. The pill and the file name are its visual echo; a long
 * name is cut short in the middle inside the box instead of widening the page, and the input's
 * tooltip shows it in full.
 */
function FileField({
  className,
  onChange,
  title,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type">) {
  const [fileName, setFileName] = useState("");
  const [head, tail] = splitFileName(fileName);
  return (
    <div
      className={cn(
        "relative flex min-h-15 min-w-0 flex-wrap items-center gap-3 rounded-lg border border-dashed border-input bg-black/10 px-4 py-2.5 shadow-xs has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-foreground has-[:disabled]:opacity-50 has-[[aria-invalid=true]]:border-destructive",
        className,
      )}
      data-slot="file-field"
    >
      <span
        aria-hidden="true"
        className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-secondary px-3 text-xs font-bold leading-4 text-secondary-foreground"
      >
        <FileTextIcon size={16} />
        {fileName ? "Change file" : "Choose file"}
      </span>
      {/* Beside the pill while at least 8rem is left for the text, on its own line below that. */}
      {fileName ? (
        // Backups share a "pubky-" prefix, so the end of the name is what tells them apart: the
        // head gives way to an ellipsis, and the stem's last characters and the extension stay.
        <span
          aria-hidden="true"
          className="flex min-w-0 flex-[1_1_8rem] overflow-hidden text-sm font-medium leading-5 text-foreground"
          data-slot="file-name"
        >
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{head}</span>
          <span className="shrink-0 whitespace-pre">{tail}</span>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="min-w-0 flex-[1_1_8rem] truncate text-sm leading-5 text-muted-foreground"
        >
          No file chosen
        </span>
      )}
      <input
        {...props}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        // The input lies over the whole box, so only its own tooltip can show.
        title={fileName || title}
        onChange={(event) => {
          setFileName(event.currentTarget.files?.[0]?.name ?? "");
          onChange?.(event);
        }}
        type="file"
      />
    </div>
  );
}

/** Characters of the name's stem kept beside its extension when the name is cut short. */
const KEPT_STEM_LENGTH = 8;

/** Splits a file name where it may be cut: the head gives way, the tail always shows. */
function splitFileName(name: string): [head: string, tail: string] {
  const dot = name.lastIndexOf(".");
  const stemLength = dot > 0 ? dot : name.length;
  const cut = Math.max(0, stemLength - KEPT_STEM_LENGTH);
  return [name.slice(0, cut), name.slice(cut)];
}

export { FileField };
