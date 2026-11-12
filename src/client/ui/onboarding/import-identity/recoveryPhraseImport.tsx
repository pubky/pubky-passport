import { Result } from "better-result";
import { type ClipboardEvent, useEffect, useRef, useState } from "react";

import {
  isRecoveryPhraseWord,
  normalizeRecoveryWord,
  RECOVERY_PHRASE_WORD_COUNT,
  splitRecoveryPhrase,
} from "@/client/logic/identity-import/recoveryPhrase";
import type { LocalIdentityImportErrorCode } from "@/client/logic/local-identity/LocalIdentityController";
import { BackButton } from "@/client/ui/shared/backButton";
import { RotateCcwIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { importErrorMessage } from "./importErrorMessage";
import type { ImportIdentity, ImportedIdentityHandler } from "./importIdentityTypes";
import { RecoveredPubky } from "./recoveredPubky";

const EMPTY_WORDS: readonly string[] = Object.freeze(
  Array<string>(RECOVERY_PHRASE_WORD_COUNT).fill(""),
);
const UNTOUCHED: readonly boolean[] = Object.freeze(
  Array<boolean>(RECOVERY_PHRASE_WORD_COUNT).fill(false),
);

/**
 * Twelve word inputs, after pubky.app's recovery phrase dialog. Pasting the whole phrase into any
 * input fills all twelve; each word is checked against the BIP39 English wordlist when it loses
 * focus.
 *
 * The words live only in this component's state: never in a form, the URL, storage, logs or
 * toasts. JS strings cannot be wiped, so the state is dropped as soon as it is not needed.
 */
function RecoveryPhraseImport({
  importIdentity,
  onBack,
  onImported,
}: {
  importIdentity: ImportIdentity;
  onBack: () => void;
  onImported: ImportedIdentityHandler;
}) {
  const [words, setWords] = useState<readonly string[]>(EMPTY_WORDS);
  const [touched, setTouched] = useState<readonly boolean[]>(UNTOUCHED);
  const [tooManyWords, setTooManyWords] = useState(false);
  const [failure, setFailure] = useState<LocalIdentityImportErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [recoveredPubky, setRecoveredPubky] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const invalid = words.map(
    (word, index) => touched[index] === true && word !== "" && !isRecoveryPhraseWord(word),
  );
  const complete = words.every(isRecoveryPhraseWord);

  function edited() {
    setFailure(null);
    setTooManyWords(false);
    setRecoveredPubky(null);
  }

  /** Spreads several words over the inputs; returns false for a single word. */
  function spread(index: number, text: string): boolean {
    const parts = splitRecoveryPhrase(text);
    if (parts.length <= 1) return false;
    edited();
    const start = parts.length === RECOVERY_PHRASE_WORD_COUNT ? 0 : index;
    if (start + parts.length > RECOVERY_PHRASE_WORD_COUNT) {
      setTooManyWords(true);
      return true;
    }
    setWords((current) => current.map((word, i) => parts[i - start] ?? word));
    setTouched((current) =>
      current.map((value, i) => value || (i >= start && i < start + parts.length)),
    );
    inputs.current[Math.min(start + parts.length, RECOVERY_PHRASE_WORD_COUNT - 1)]?.focus();
    return true;
  }

  function change(index: number, value: string) {
    if (spread(index, value)) return;
    edited();
    const word = normalizeRecoveryWord(value);
    setWords((current) => current.map((existing, i) => (i === index ? word : existing)));
    // A typed space ends the word and moves on, as on a phone keyboard.
    if (word !== "" && /\s$/u.test(value)) {
      touch(index);
      inputs.current[index + 1]?.focus();
    }
  }

  function touch(index: number) {
    setTouched((current) => (current[index] ? current : current.map((v, i) => v || i === index)));
  }

  function paste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    // Inputs drop line breaks from pasted text, so a multi-line phrase is spread here instead.
    if (splitRecoveryPhrase(text).length > 1) {
      event.preventDefault();
      spread(index, text);
    }
  }

  async function restore() {
    if (!complete || pending) return;
    setTouched(UNTOUCHED.map(() => true));
    setPending(true);
    edited();
    try {
      const result = await importIdentity(
        { kind: "recovery-phrase", words: [...words] },
        (publicIdentity) => {
          if (active.current) setRecoveredPubky(publicIdentity.publicKeyZ32);
        },
      );
      if (!active.current) return;
      if (Result.isError(result)) {
        setFailure(result.error.code);
        return;
      }
      setWords(EMPTY_WORDS);
      onImported(result.value);
    } catch {
      if (active.current) setFailure("import_failed");
    } finally {
      if (active.current) setPending(false);
    }
  }

  const message = tooManyWords
    ? "A recovery phrase has 12 words. Check what you pasted."
    : invalid.some(Boolean)
      ? "Invalid words detected. Check the spelling of the marked words."
      : failure
        ? importErrorMessage(failure)
        : null;

  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="phrase." aria-label="Recovery phrase.">
          Recovery
        </DisplayHeading>
        <LeadText>
          Use your 12 words (recovery phrase) to restore your account and sign in.
        </LeadText>
      </div>
      <div className="flex flex-col gap-3">
        <div
          aria-label="Recovery phrase"
          className="grid grid-cols-2 gap-3"
          role="group"
          translate="no"
        >
          {words.map((word, index) => (
            <WordInput
              index={index}
              invalid={invalid[index] === true}
              key={index}
              disabled={pending}
              onBlur={() => touch(index)}
              onChange={(value) => change(index, value)}
              onEnter={() => {
                void restore();
              }}
              onPaste={(event) => paste(index, event)}
              ref={(input) => {
                inputs.current[index] = input;
              }}
              word={word}
            />
          ))}
        </div>
        {message ? <FieldMessage error>{message}</FieldMessage> : null}
        <FieldMessage>
          Only enter the recovery phrase of a pubky. Never enter a wallet’s recovery phrase here.
        </FieldMessage>
      </div>
      {recoveredPubky ? <RecoveredPubky pending={pending} publicKeyZ32={recoveredPubky} /> : null}
      <PassportNavigation
        back={<BackButton disabled={pending} onClick={onBack} />}
        className="mt-auto pt-2"
        confirm={
          <Button
            className="w-full"
            disabled={!complete || pending}
            onClick={() => {
              void restore();
            }}
            size="lg"
          >
            <RotateCcwIcon />
            {pending ? "Restoring…" : "Restore"}
          </Button>
        }
      />
    </PassportScreen>
  );
}

function WordInput({
  disabled,
  index,
  invalid,
  onBlur,
  onChange,
  onEnter,
  onPaste,
  ref,
  word,
}: {
  disabled: boolean;
  index: number;
  invalid: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onEnter: () => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  ref: (input: HTMLInputElement | null) => void;
  word: string;
}) {
  return (
    <div
      className={cn(
        "flex h-12 min-w-0 items-center gap-2 rounded-lg border border-dashed border-input bg-black/10 pl-2 pr-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-[:disabled]:opacity-50",
        invalid && "border-destructive bg-destructive/10",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground",
          invalid && "bg-destructive text-destructive-foreground",
        )}
      >
        {index + 1}
      </span>
      <input
        aria-invalid={invalid || undefined}
        aria-label={`Word ${index + 1}`}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="min-w-0 flex-1 bg-transparent text-base font-medium leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        data-1p-ignore=""
        data-bwignore=""
        data-form-type="other"
        data-lpignore="true"
        disabled={disabled}
        enterKeyHint={index === RECOVERY_PHRASE_WORD_COUNT - 1 ? "done" : "next"}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter();
          }
        }}
        onPaste={onPaste}
        placeholder="word"
        ref={ref}
        spellCheck={false}
        translate="no"
        type="text"
        value={word}
      />
    </div>
  );
}

export { RecoveryPhraseImport };
