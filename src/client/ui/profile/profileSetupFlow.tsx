import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Result } from "better-result";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileController, ProfileErrorCode } from "@/client/logic/profile/ProfileController";
import { PROFILE_LIMITS } from "@/client/logic/profile/ProfileSpecsAdapter";
import { isAvatarFile, type PubkyProfile } from "@/client/logic/profile/profile";
import {
  draftFromProfile,
  linkFieldKey,
  linkUrlLength,
  nextLinkId,
  profileDraftChanged,
  profileFromDraft,
  profileTextLength,
  validateProfileDraft,
  X_TWITTER,
  type ProfileDraft,
  type ProfileLinkField,
  type ProfileFieldErrorCode,
  type ProfileFieldErrors,
  type ProfileFieldKey,
  type UnsavedProfileEdits,
} from "@/client/logic/profile/profileDraft";
import { BackButton } from "@/client/ui/shared/backButton";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ArrowRightIcon, CheckIcon, RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { Textarea } from "@/client/ui/shared/primitives/textarea";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import {
  ACCOUNT_SETUP_STEPS,
  GOOGLE_SETUP_STEPS,
  SetupProgressProvider,
} from "@/client/ui/shared/setupProgress";
import { AccountCreated } from "./accountCreated";
import { DiscardChangesDialog } from "./discardChangesDialog";

type ProfileSetupFlowProps = {
  identity: LocalIdentityMetadata;
  controller: Pick<ProfileController, "load" | "save" | "checkAvatar">;
  /** Returns to where the form was opened from; absent right after an identity was added. */
  onBack?: (() => void) | undefined;
  onComplete: (profile: PubkyProfile, avatar?: File) => void;
  /**
   * Leaves setup unfinished and goes on ("Skip for now"); the identity stays usable meanwhile.
   * Offered right after an identity was added, where it is the one way to skip.
   */
  onDefer?: (() => void) | undefined;
  /**
   * The account was just created with its key in this browser: an "Account created." moment
   * comes first, since nothing before it said so. Needs `onDefer`, its way to skip the profile.
   */
  created?: boolean;
  /** An app's sign-in request waits, so skipping the profile goes on to it. */
  forRequest?: boolean;
  /** Returns to the Ring connection after its grant has ended, keeping the unpublished `edits`. */
  onReconnect?: ((edits: UnsavedProfileEdits) => void) | undefined;
  /** Edits kept across a Ring reconnect: the form opens with them over the published profile. */
  keptEdits?: UnsavedProfileEdits | undefined;
};

export function ProfileSetupFlow({
  created = false,
  forRequest = false,
  ...props
}: ProfileSetupFlowProps) {
  // Frozen for this visit: completing setup must not reshape the screen mid-save.
  const [required] = useState(props.identity.profileSetupRequired === true);
  const [announcing, setAnnouncing] = useState(created && required && props.onDefer !== undefined);
  if (!required) return <ProfileEditor {...props} required={false} />;
  const steps = props.identity.googleAccount ? GOOGLE_SETUP_STEPS : ACCOUNT_SETUP_STEPS;
  return (
    <SetupProgressProvider steps={steps} current={steps.length - 1}>
      {announcing && props.onDefer ? (
        <AccountCreated
          forRequest={forRequest}
          onAddProfile={() => setAnnouncing(false)}
          onSkip={props.onDefer}
          publicKeyZ32={props.identity.publicIdentity.publicKeyZ32}
        />
      ) : (
        <ProfileEditor {...props} required />
      )}
    </SetupProgressProvider>
  );
}

const NAME_HINT = `${PROFILE_LIMITS.nameMinLength}–${PROFILE_LIMITS.nameMaxLength} characters. Shown publicly.`;
// The fallback for a profile the specs WASM refuses although every field passed its own check.
const INVALID_PROFILE_MESSAGE = `Use a name of ${PROFILE_LIMITS.nameMinLength}–${PROFILE_LIMITS.nameMaxLength} characters, a bio of up to ${PROFILE_LIMITS.bioMaxLength} characters, and valid links with titles (up to ${PROFILE_LIMITS.linksMaxCount}).`;
const INVALID_AVATAR_MESSAGE = "Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.";
const DAMAGED_AVATAR_MESSAGE = `This image can’t be opened. ${INVALID_AVATAR_MESSAGE}`;
const AVATAR_HINT = "PNG, JPEG, WebP, or GIF, up to 5 MB.";

type FieldMessageContext = {
  /** The field's length as the specs measure it. */
  length?: number;
  /** The length is of the stored address, which differs from what was typed. */
  encoded?: boolean;
  xLink?: boolean;
};

function fieldErrorMessage(
  code: ProfileFieldErrorCode,
  { length = 0, encoded = false, xLink = false }: FieldMessageContext = {},
): string {
  switch (code) {
    case "name_length":
      return `Enter a name of ${PROFILE_LIMITS.nameMinLength}–${PROFILE_LIMITS.nameMaxLength} characters.`;
    case "bio_too_long":
      return `Keep your bio to ${PROFILE_LIMITS.bioMaxLength} characters (you have ${length}).`;
    case "link_title_missing":
      return "Give this link a title.";
    case "link_title_too_long":
      return `Keep this title to ${PROFILE_LIMITS.linkTitleMaxLength} characters or fewer (you have ${length}).`;
    case "link_url_invalid":
      return xLink
        ? "Enter an X handle, like @satoshi, or a full web address."
        : "Enter a full web address, like https://example.com.";
    case "link_url_too_long":
      return `Keep this address to ${PROFILE_LIMITS.linkUrlMaxLength} characters or fewer (${encoded ? `it is ${length} once encoded` : `you have ${length}`}).`;
  }
}

type DescribedFieldError = { key: ProfileFieldKey; label: string; message: string };

/** Each refused field's control name and message, in the order the form shows them. */
function describeFieldErrors(
  draft: ProfileDraft,
  errors: ProfileFieldErrors,
): DescribedFieldError[] {
  const described: DescribedFieldError[] = [];
  const add = (key: ProfileFieldKey, label: string, context?: FieldMessageContext) => {
    const code = errors[key];
    if (code) described.push({ key, label, message: fieldErrorMessage(code, context) });
  };
  add("name", "Name");
  add("bio", "Bio", { length: profileTextLength(draft.bio) });
  draft.links.forEach((link, index) => {
    add(linkFieldKey(link.id, "title"), `Link ${index + 1} title`, {
      length: profileTextLength(link.title),
    });
    const url = linkUrlLength(link);
    add(linkFieldKey(link.id, "url"), link.fixedTitle ? link.title : `Link ${index + 1} address`, {
      length: url?.stored ?? 0,
      encoded: url !== null && url.stored !== url.typed,
      xLink: link.title === X_TWITTER,
    });
  });
  return described;
}

/** What a refused save announces: how many fields to change, and the first one's message. */
function refusalAnnouncement([first, ...rest]: DescribedFieldError[]): string {
  const count = rest.length + 1;
  const summary = count === 1 ? "1 field needs a change." : `${count} fields need changes.`;
  return first ? `${summary} ${first.label}: ${first.message}` : "";
}

function withoutFields(errors: ProfileFieldErrors, fields: ProfileFieldKey[]): ProfileFieldErrors {
  if (!fields.some((field) => field in errors)) return errors;
  const rest = { ...errors };
  for (const field of fields) delete rest[field];
  return rest;
}

/** A failed save, about the whole form; a refused avatar is told by its picker instead. */
function saveErrorMessage(
  code: Exclude<ProfileErrorCode, "cancelled" | "invalid_avatar">,
  canReconnect: boolean,
): string {
  switch (code) {
    case "invalid_profile":
      return INVALID_PROFILE_MESSAGE;
    case "identity_unavailable":
      return "This identity is no longer available in this browser. Your profile was not changed.";
    case "disconnected":
      return canReconnect
        ? "Your connection to Pubky Ring ended before your changes were saved. Reconnect Pubky Ring to publish them. Your edits are kept."
        : "Your connection to Pubky Ring has ended. Connect Pubky Ring again to save your profile.";
    case "storage_failed":
      return "Your profile was published, but Passport could not finish setup in this browser. Try Save profile again.";
    case "load_failed":
    case "save_failed":
      return "Could not save your profile. Your identity is safe. Check your connection and try again.";
  }
}

function ProfileEditor({
  identity,
  controller,
  required,
  onBack,
  onComplete,
  onDefer,
  onReconnect,
  keptEdits,
}: ProfileSetupFlowProps & { required: boolean }) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  const [draft, setDraft] = useState<ProfileDraft>();
  // The draft as loaded, to tell unpublished changes from none.
  const [savedDraft, setSavedDraft] = useState<ProfileDraft>();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [avatar, setAvatar] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  // A failed save, about the whole form; a refused avatar is the picker's own error.
  const [error, setError] = useState<{ message: string; reconnect?: boolean }>();
  const [avatarError, setAvatarError] = useState<"unsupported" | "damaged">();
  // Each chosen file is checked before it is used; only the latest choice may land, and a save
  // pressed meanwhile waits for its check (`pending`, the file once it passed).
  const avatarCheck = useRef<{ latest: number; pending: Promise<File | undefined> | undefined }>({
    latest: 0,
    pending: undefined,
  });
  // A name suggested from the Google account while nothing is published yet.
  const [suggestedName, setSuggestedName] = useState<string>();
  // Fields the last save found invalid; each clears when its field, or its link, changes.
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  // Spoken for every refused save, since focus may already be on the first invalid field (Enter
  // submits from inside it) and then moving it announces nothing. `attempt` renews the text node,
  // so a repeated refusal is spoken again.
  const [refusal, setRefusal] = useState<{ text: string; attempt: number }>();
  const revealFieldError = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const nextLink = useRef<number>(PROFILE_LIMITS.linksMaxCount);
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const initialGoogleName = identity.googleAccount?.name ?? "";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void controller.load(publicKey).then((result) => {
      if (!active) return;
      setLoading(false);
      // A document that cannot be read fails identically on retry, so it opens an empty form.
      const invalid = Result.isError(result) && result.error.code === "invalid_profile";
      if (Result.isError(result) && !invalid) {
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setUnreadable(invalid);
      const loaded = Result.isOk(result) ? result.value : null;
      // An avatar deleted before a reconnect stays deleted.
      if (loaded?.avatar && keptEdits?.draft.image !== null)
        objectUrl = URL.createObjectURL(loaded.avatar);
      setPreview(objectUrl);
      const opened = draftFromProfile(loaded?.profile, initialGoogleName);
      const draft = keptEdits?.draft ?? opened;
      setDraft(draft);
      setSavedDraft(opened);
      setAvatar(keptEdits?.avatar);
      nextLink.current = nextLinkId(draft);
      // A published name is public already; only one Passport filled in is worth pointing out.
      setSuggestedName(loaded === null && initialGoogleName ? initialGoogleName : undefined);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [controller, publicKey, initialGoogleName, keptEdits, attempt]);
  // A retry that loads the profile replaces the focused Try again with the form.
  useLayoutEffect(() => {
    if (attempt > 0 && !loading && !loadFailed) nameInput.current?.focus();
  }, [attempt, loading, loadFailed]);
  // After a refused save, the first marked control in reading order takes focus, which reads its
  // message, and is centred so its label and message are in view.
  useLayoutEffect(() => {
    if (!revealFieldError.current) return;
    revealFieldError.current = false;
    const control = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: "center" });
  }, [fieldErrors]);
  const [filePreview, setFilePreview] = useState<string>();
  useEffect(() => {
    if (!avatar) return;
    const url = URL.createObjectURL(avatar);
    queueMicrotask(() => setFilePreview(url));
    return () => URL.revokeObjectURL(url);
  }, [avatar]);

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy.current) return;
    const invalid = validateProfileDraft(draft);
    // Also clears messages whose cause was fixed through another field.
    setFieldErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setError(undefined);
      revealFieldError.current = true;
      const text = refusalAnnouncement(describeFieldErrors(draft, invalid));
      setRefusal((last) => ({ text, attempt: (last?.attempt ?? 0) + 1 }));
      return;
    }
    setRefusal(undefined);
    busy.current = true;
    setSaving(true);
    // A file still being checked is saved once it passes; a refused one stops the save, and its
    // picker says why.
    let chosen = avatar;
    const checking = avatarCheck.current.pending;
    if (checking) {
      chosen = await checking;
      if (!mounted.current) return;
      if (!chosen) {
        busy.current = false;
        setSaving(false);
        return;
      }
    }
    setError(undefined);
    setAvatarError(undefined);
    const result = await controller.save(publicKey, profileFromDraft(draft), chosen);
    busy.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (Result.isOk(result)) {
      onComplete(result.value, chosen);
      return;
    }
    // A cancelled save belongs to a connection this screen no longer shows.
    if (result.error.code === "cancelled") return;
    // Checked when chosen, so rare: the picker says so and offers another choice.
    if (result.error.code === "invalid_avatar") {
      setAvatar(undefined);
      setFilePreview(undefined);
      setAvatarError("damaged");
      return;
    }
    const reconnect = result.error.code === "disconnected" && onReconnect !== undefined;
    setError({ message: saveErrorMessage(result.error.code, reconnect), reconnect });
  }

  /** Uses `file` only once it passes the checks a save runs; a refused file keeps the avatar. */
  function chooseAvatar(file: File) {
    const check = ++avatarCheck.current.latest;
    // The error stays by the picker, which keeps focus for another choice.
    if (!isAvatarFile(file)) {
      avatarCheck.current.pending = undefined;
      setAvatarError("unsupported");
      return;
    }
    avatarCheck.current.pending = controller.checkAvatar(file).then((checked) => {
      if (!mounted.current || check !== avatarCheck.current.latest) return undefined;
      avatarCheck.current.pending = undefined;
      if (Result.isError(checked)) {
        setAvatarError("damaged");
        return undefined;
      }
      setAvatar(file);
      setAvatarError(undefined);
      // A new avatar answers a failed save's message, but not an ended connection: saving still
      // needs Pubky Ring connected again first.
      setError((current) => (current?.reconnect ? current : undefined));
      return file;
    });
  }

  const skip = onDefer ? (
    <Button disabled={saving} onClick={onDefer} size="lg" type="button" variant="outline">
      Skip for now
    </Button>
  ) : null;
  // Back never detours through backups: the key was backed up before this step, and further
  // backups live in Manage. Right after an identity is added there is no Back: Skip for now is the
  // one way on without a profile, so it takes Back's place, first in the row and always in view.
  const back = onBack;
  const changed =
    avatar !== undefined ||
    (draft !== undefined && savedDraft !== undefined && profileDraftChanged(draft, savedDraft));
  // Leaving with unpublished changes asks first; there is nothing to lose otherwise.
  const leave = back && changed ? () => setConfirmingDiscard(true) : back;
  const avatarRemoved = Boolean(savedDraft?.image) && draft?.image === null && !avatar;
  const bioLength = draft ? profileTextLength(draft.bio) : 0;
  const nameSuggested = suggestedName !== undefined && draft?.name === suggestedName;
  const avatarSrc = avatar ? filePreview : preview;
  const bioTooLong = bioLength > PROFILE_LIMITS.bioMaxLength;
  const messages: Partial<Record<ProfileFieldKey, string>> = Object.fromEntries(
    draft ? describeFieldErrors(draft, fieldErrors).map(({ key, message }) => [key, message]) : [],
  );
  function edit(next: ProfileDraft, ...fields: ProfileFieldKey[]) {
    setDraft(next);
    setFieldErrors((errors) => withoutFields(errors, fields));
  }
  // A link's title and URL are judged together: a title is needed only beside a URL, and a bare
  // handle is an address only under the X title. So editing either clears both messages.
  function editLink(id: number, change: Partial<ProfileLinkField>) {
    if (!draft) return;
    const links = draft.links.map((item) => (item.id === id ? { ...item, ...change } : item));
    edit({ ...draft, links }, linkFieldKey(id, "title"), linkFieldKey(id, "url"));
  }

  return (
    <PassportScreen width="wide" className="gap-6">
      <div className="space-y-3">
        <DisplayHeading accent="profile." className="[&>span]:inline">
          {required ? "Create your " : "Your "}
        </DisplayHeading>
        <LeadText>
          {required
            ? "Optional. Add a name, bio, links, and avatar. Anyone can see your profile, including apps you sign in to."
            : "Changes are published to your public profile when you save."}
        </LeadText>
      </div>
      {loading ? (
        <p className="flex items-center gap-2" role="status">
          <Spinner className="size-4" decorative />
          Loading your profile…
        </p>
      ) : loadFailed || !draft ? (
        <Notice tone="error">Could not load your profile. Try again before making changes.</Notice>
      ) : (
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => void finish(event)}
          ref={form}
        >
          <p className="sr-only" role="status">
            {refusal ? <span key={refusal.attempt}>{refusal.text}</span> : null}
          </p>
          {keptEdits && !error ? (
            <Notice tone="info">
              Pubky Ring is connected again. Your changes are still here. Save to publish them.
            </Notice>
          ) : null}
          {unreadable ? (
            // Saving over a published profile cannot be undone, so it is a callout, not a hint.
            <Notice tone="warning">
              <p>
                <strong>We couldn’t read your current profile.</strong> A profile is already
                published for this pubky. Saving here replaces it everywhere it’s shown.
              </p>
            </Notice>
          ) : null}
          <fieldset
            disabled={saving}
            className="grid min-w-0 gap-8 rounded-lg bg-card p-6 md:p-12 lg:grid-cols-3 lg:gap-12"
          >
            <legend className="sr-only">Public profile</legend>
            <section
              className="flex min-w-0 flex-col gap-6"
              aria-labelledby="profile-details-heading"
            >
              <h2 id="profile-details-heading" className="text-2xl font-bold leading-8">
                Profile
              </h2>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  aria-describedby={`${nameSuggested ? "profile-name-source " : ""}${
                    messages.name ? "profile-name-error" : "profile-name-hint"
                  }`}
                  aria-invalid={messages.name ? true : undefined}
                  aria-required
                  autoComplete="nickname"
                  id="profile-name"
                  ref={nameInput}
                  containerClassName="border-dashed"
                  value={draft.name}
                  onChange={(event) => edit({ ...draft, name: event.target.value }, "name")}
                  placeholder="Your name"
                />
                {nameSuggested ? (
                  <FieldMessage id="profile-name-source">
                    From your Google account. Change it if you don’t want it public.
                  </FieldMessage>
                ) : null}
                {messages.name ? (
                  <FieldMessage announce={false} error id="profile-name-error">
                    {messages.name}
                  </FieldMessage>
                ) : (
                  <FieldMessage id="profile-name-hint">{NAME_HINT}</FieldMessage>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-bio">Bio</Label>
                <Textarea
                  aria-describedby={messages.bio ? "profile-bio-error" : "profile-bio-count"}
                  aria-invalid={messages.bio || bioTooLong ? true : undefined}
                  id="profile-bio"
                  className="border-dashed"
                  placeholder="Tell a bit about yourself."
                  value={draft.bio}
                  onChange={(event) => edit({ ...draft, bio: event.target.value }, "bio")}
                />
                {messages.bio ? (
                  <FieldMessage announce={false} error id="profile-bio-error">
                    {messages.bio}
                  </FieldMessage>
                ) : (
                  // Updated on every keystroke, so it is read with the field, not announced.
                  <FieldMessage
                    announce={false}
                    className="self-end tabular-nums"
                    error={bioTooLong}
                    id="profile-bio-count"
                  >
                    <span aria-hidden="true">
                      {bioLength}/{PROFILE_LIMITS.bioMaxLength}
                    </span>
                    <span className="sr-only">
                      {bioLength} of {PROFILE_LIMITS.bioMaxLength} characters
                    </span>
                  </FieldMessage>
                )}
              </div>
            </section>
            <section
              className="flex min-w-0 flex-col gap-6"
              aria-labelledby="profile-links-heading"
            >
              <h2 id="profile-links-heading" className="text-2xl font-bold leading-8">
                Links
              </h2>
              {draft.links.map((link, index) => {
                const titleKey = linkFieldKey(link.id, "title");
                const urlKey = linkFieldKey(link.id, "url");
                const titleError = messages[titleKey];
                const urlError = messages[urlKey];
                const remove = () =>
                  edit(
                    { ...draft, links: draft.links.filter((item) => item.id !== link.id) },
                    titleKey,
                    urlKey,
                  );
                const url = (
                  <>
                    <Input
                      aria-describedby={urlError ? `profile-link-${link.id}-error` : undefined}
                      aria-invalid={urlError ? true : undefined}
                      id={`profile-link-${link.id}`}
                      containerClassName="border-dashed"
                      placeholder={link.title === X_TWITTER ? "@user" : "https://"}
                      value={link.url}
                      onChange={(event) => editLink(link.id, { url: event.target.value })}
                      action={
                        link.fixedTitle ? (
                          // A 40px target (44px by touch) whose icon stays where the field's
                          // padding put it.
                          <IconButton
                            type="button"
                            variant="ghost"
                            className="-mr-3"
                            aria-label={`Remove ${link.title}`}
                            onClick={remove}
                          >
                            <TrashIcon />
                          </IconButton>
                        ) : undefined
                      }
                    />
                    {urlError ? (
                      <FieldMessage announce={false} error id={`profile-link-${link.id}-error`}>
                        {urlError}
                      </FieldMessage>
                    ) : null}
                  </>
                );
                if (link.fixedTitle)
                  return (
                    <div key={link.id} className="flex flex-col gap-2">
                      <Label htmlFor={`profile-link-${link.id}`}>{link.title}</Label>
                      {url}
                    </div>
                  );
                // An added link is a titled group, so each of its two fields keeps a visible
                // label once filled, and its remove button says which link it removes.
                const number = index + 1;
                const title = link.title.trim();
                return (
                  // Below md a box would cost its fields their width in the narrow column, so
                  // a rule above the group sets it apart instead.
                  <fieldset
                    key={link.id}
                    className="min-w-0 border-t border-border pt-4 md:rounded-lg md:border md:p-4"
                  >
                    <legend className="sr-only">Link {number}</legend>
                    <div className="flex flex-col gap-4">
                      <div className="-my-2 flex items-center justify-between gap-3">
                        <span aria-hidden="true" className="text-sm font-bold leading-5">
                          Link {number}
                        </span>
                        <IconButton
                          type="button"
                          variant="ghost"
                          className="-mr-2"
                          aria-label={`Remove link ${number}${title ? ` (${title})` : ""}`}
                          onClick={remove}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`profile-link-${link.id}-title`}>Title</Label>
                        <Input
                          aria-describedby={
                            titleError ? `profile-link-${link.id}-title-error` : undefined
                          }
                          aria-invalid={titleError ? true : undefined}
                          id={`profile-link-${link.id}-title`}
                          value={link.title}
                          containerClassName="border-dashed"
                          onChange={(event) => editLink(link.id, { title: event.target.value })}
                        />
                        {titleError ? (
                          <FieldMessage
                            announce={false}
                            error
                            id={`profile-link-${link.id}-title-error`}
                          >
                            {titleError}
                          </FieldMessage>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`profile-link-${link.id}`}>Address</Label>
                        {url}
                      </div>
                    </div>
                  </fieldset>
                );
              })}
              {draft.links.length < PROFILE_LIMITS.linksMaxCount ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      links: [
                        ...draft.links,
                        { id: nextLink.current++, title: "", url: "", fixedTitle: false },
                      ],
                    })
                  }
                >
                  <Image alt="" src="/icons/profile-link.svg" width={16} height={16} /> Add link
                </Button>
              ) : null}
            </section>
            <section
              aria-labelledby="profile-avatar-heading"
              className="flex min-w-0 flex-col items-center gap-6"
            >
              <h2 id="profile-avatar-heading" className="text-2xl font-bold leading-8">
                Avatar
              </h2>
              <Image
                alt={avatarSrc ? "Your avatar" : ""}
                // Square at any width: a column narrower than 192px shrinks the whole circle.
                className="aspect-square h-auto w-48 rounded-full bg-muted object-cover"
                width={192}
                height={192}
                unoptimized
                src={avatarSrc ?? "/illustrations/profile-avatar.svg"}
                // An image the browser cannot draw gives way to the placeholder, not an empty
                // circle; a chosen file is then refused like one that failed its check.
                onError={() => {
                  if (avatar && filePreview) {
                    setAvatar(undefined);
                    setFilePreview(undefined);
                    setAvatarError("damaged");
                  } else if (preview) setPreview(undefined);
                }}
              />
              {avatar || draft.image ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAvatar(undefined);
                    setFilePreview(undefined);
                    setPreview(undefined);
                    setDraft({ ...draft, image: null });
                  }}
                >
                  <TrashIcon /> Delete
                </Button>
              ) : (
                <label className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full pointer-coarse:h-11 bg-secondary px-3 text-xs font-bold text-secondary-foreground has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-foreground">
                  <Image alt="" src="/icons/profile-file.svg" width={16} height={16} /> Choose file
                  <input
                    aria-describedby={avatarError ? "profile-avatar-error" : "profile-avatar-hint"}
                    aria-invalid={avatarError ? true : undefined}
                    aria-label="Choose avatar file"
                    className="absolute inset-0 w-full cursor-pointer opacity-0"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) chooseAvatar(file);
                    }}
                  />
                </label>
              )}
              {avatarError ? (
                <FieldMessage className="text-center" error id="profile-avatar-error">
                  {avatarError === "damaged" ? DAMAGED_AVATAR_MESSAGE : INVALID_AVATAR_MESSAGE}
                </FieldMessage>
              ) : avatar || draft.image ? null : (
                <FieldMessage className="text-center" id="profile-avatar-hint">
                  {AVATAR_HINT}
                </FieldMessage>
              )}
              {avatarRemoved ? (
                <FieldMessage className="text-center">
                  Your avatar is removed when you save.
                </FieldMessage>
              ) : null}
            </section>
          </fieldset>
          {error ? (
            <Notice focusOnMount tone="error">
              {error.message}
            </Notice>
          ) : null}
          {/* Below md the actions stay pinned to the window, so the save and the way out are in
              view in the popup; one row at every width keeps the bar short over the form, and the
              page's scroll padding keeps focused fields clear of it. */}
          <div
            className="sticky bottom-0 z-10 -mx-6 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
            data-sticky-actions
          >
            <PassportNavigation
              back={leave ? <BackButton disabled={saving} onClick={leave} /> : skip}
              confirm={
                // Saving cannot succeed until Ring is connected again, so that is the way on.
                error?.reconnect && onReconnect ? (
                  <Button
                    className="w-full"
                    onClick={() => onReconnect({ draft, avatar })}
                    size="lg"
                    type="button"
                  >
                    <PubkyBrandIcon />
                    Reconnect Pubky Ring
                  </Button>
                ) : (
                  <Button className="w-full" loading={saving} size="lg" type="submit">
                    {required ? <ArrowRightIcon /> : <CheckIcon />}
                    {submitLabel(required, unreadable, saving)}
                  </Button>
                )
              }
              layout="inline"
            />
          </div>
        </form>
      )}
      {loading || loadFailed ? (
        <PassportNavigation
          back={back ? <BackButton onClick={back} /> : skip}
          confirm={
            loadFailed ? (
              // Stays mounted through the retry, so focus is not lost while it runs.
              <Button
                className="w-full"
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  setAttempt((value) => value + 1);
                }}
                size="lg"
              >
                <RotateCcwIcon />
                Try again
              </Button>
            ) : undefined
          }
          layout="inline"
        />
      ) : null}
      {back ? (
        <DiscardChangesDialog
          onDiscard={() => {
            setConfirmingDiscard(false);
            back();
          }}
          onKeepEditing={() => setConfirmingDiscard(false)}
          open={confirmingDiscard}
        />
      ) : null}
    </PassportScreen>
  );
}

/** Setup finishes a step; editing publishes changes to a profile that is already public. */
function submitLabel(required: boolean, unreadable: boolean, saving: boolean): string {
  if (unreadable) return saving ? "Replacing…" : "Replace profile";
  if (required) return saving ? "Saving…" : "Save profile";
  return saving ? "Publishing…" : "Save";
}
