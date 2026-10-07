"use client";

import { type FormEvent, useId, useState } from "react";

import { PROFILE_LIMITS } from "@/client/logic/profile/ProfileSpecsAdapter";
import { profileTextLength } from "@/client/logic/profile/profileDraft";
import { ClipboardPasteIcon, XIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";

/**
 * Adds one link to the profile, as pubky.app asks for it: a label and an address, then Save Link.
 * The label must be there and fit; the address is checked with the others when the profile is
 * saved. The address field can take what the clipboard holds.
 */
export function AddLinkDialog({
  onCancel,
  onSave,
  open,
}: {
  onCancel: () => void;
  onSave: (link: { title: string; url: string }) => void;
  open: boolean;
}) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [tried, setTried] = useState(false);
  const titleLength = profileTextLength(title.trim());
  const titleError = !title.trim()
    ? "Give this link a label."
    : titleLength > PROFILE_LIMITS.linkTitleMaxLength
      ? `Keep the label to ${PROFILE_LIMITS.linkTitleMaxLength} characters or fewer (you have ${titleLength}).`
      : undefined;
  const urlError = !url.trim()
    ? "Enter a full address with its scheme, like https://example.com or mailto:you@example.com."
    : undefined;
  const close = () => {
    setTitle("");
    setUrl("");
    setTried(false);
    onCancel();
  };
  function save(event: FormEvent) {
    event.preventDefault();
    // The dialog's form must not submit the profile form it sits in.
    event.stopPropagation();
    setTried(true);
    if (titleError || urlError) return;
    onSave({ title: title.trim(), url: url.trim() });
    setTitle("");
    setUrl("");
    setTried(false);
  }
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // Without clipboard access the field still takes a paste from the keyboard.
    }
  }
  return (
    <Dialog
      aria-labelledby={titleId}
      className="m-auto w-[min(100%-2rem,375px)] rounded-xl border bg-background p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75"
      onOpenChange={(next) => {
        if (!next) close();
      }}
      open={open}
    >
      <form className="flex flex-col gap-6" noValidate onSubmit={save}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold leading-7" id={titleId}>
            Add link
          </h2>
          <IconButton aria-label="Close" onClick={close} type="button" variant="secondary">
            <XIcon />
          </IconButton>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${titleId}-label`}>Label</Label>
          <Input
            aria-describedby={tried && titleError ? `${titleId}-label-error` : undefined}
            aria-invalid={tried && titleError ? true : undefined}
            containerClassName="border-dashed"
            data-autofocus
            id={`${titleId}-label`}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Twitter"
            value={title}
          />
          {tried && titleError ? (
            <FieldMessage error id={`${titleId}-label-error`}>
              {titleError}
            </FieldMessage>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${titleId}-url`}>URL</Label>
          <Input
            action={
              <IconButton
                aria-label="Paste address"
                className="-mr-3"
                onClick={() => void paste()}
                type="button"
                variant="ghost"
              >
                <ClipboardPasteIcon />
              </IconButton>
            }
            aria-describedby={tried && urlError ? `${titleId}-url-error` : undefined}
            aria-invalid={tried && urlError ? true : undefined}
            autoCapitalize="none"
            containerClassName="border-dashed"
            id={`${titleId}-url`}
            inputMode="url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            spellCheck={false}
            value={url}
          />
          {tried && urlError ? (
            <FieldMessage error id={`${titleId}-url-error`}>
              {urlError}
            </FieldMessage>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <Button className="w-full" onClick={close} type="button" variant="outline">
            Cancel
          </Button>
          <Button className="w-full" type="submit">
            Save Link
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
