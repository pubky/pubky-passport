import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Result } from "better-result";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileController, ProfileErrorCode } from "@/client/logic/profile/ProfileController";
import { PROFILE_LIMITS } from "@/client/logic/profile/ProfileSpecsAdapter";
import { isAvatarFile, type PubkyProfile } from "@/client/logic/profile/profile";
import {
  draftFromProfile,
  profileFromDraft,
  type ProfileDraft,
} from "@/client/logic/profile/profileDraft";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon, RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { ProfileBackupSteps } from "./profileBackupSteps";

type ProfileSetupFlowProps = {
  identity: LocalIdentityMetadata;
  controller: Pick<ProfileController, "load" | "save">;
  actions: IdentityCatalogActions;
  onBack: () => void;
  onComplete: (profile: PubkyProfile, avatar?: File) => void;
  /** Leaves required setup unfinished; the identity stays usable meanwhile. */
  onDefer?: (() => void) | undefined;
  /** Returns to the Ring connection after its grant has ended. */
  onReconnect?: (() => void) | undefined;
};

export function ProfileSetupFlow(props: ProfileSetupFlowProps) {
  // Frozen for this visit: completing setup must not reshape the screen mid-save.
  const [required] = useState(props.identity.profileSetupRequired === true);
  if (!required) return <ProfileEditor {...props} required={false} />;
  const steps = props.identity.googleAccount
    ? ["Google backup", "Profile"]
    : ["Account", "Keys", "Profile"];
  return (
    <SetupProgressProvider steps={steps} current={steps.length - 1}>
      <ProfileEditor {...props} required />
    </SetupProgressProvider>
  );
}

const INVALID_PROFILE_MESSAGE = `Use a name of ${PROFILE_LIMITS.nameMinLength}–${PROFILE_LIMITS.nameMaxLength} characters, a bio of up to ${PROFILE_LIMITS.bioMaxLength} characters, and valid links with titles (up to ${PROFILE_LIMITS.linksMaxCount}).`;
const INVALID_AVATAR_MESSAGE = "Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.";

function saveErrorMessage(code: Exclude<ProfileErrorCode, "cancelled">): string {
  switch (code) {
    case "invalid_profile":
      return INVALID_PROFILE_MESSAGE;
    case "invalid_avatar":
      return `Passport could not use this image. ${INVALID_AVATAR_MESSAGE}`;
    case "identity_unavailable":
      return "This identity is no longer available in this browser. Your profile was not changed.";
    case "disconnected":
      return "Your connection to Ring has ended. Connect Ring again to save your profile.";
    case "storage_failed":
      return "Your profile was published, but Passport could not finish setup in this browser. Try Finish again.";
    case "load_failed":
    case "save_failed":
      return "Could not save your profile. Your identity is safe. Check your connection and try again.";
  }
}

function ProfileEditor({
  identity,
  controller,
  actions,
  required,
  onBack,
  onComplete,
  onDefer,
  onReconnect,
}: ProfileSetupFlowProps & { required: boolean }) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  // Onboarding passes the backup step on the way back; a Google backup already happened.
  const backupStep = required && !identity.googleAccount;
  const [view, setView] = useState<"profile" | "backup">("profile");
  const [draft, setDraft] = useState<ProfileDraft>();
  const [avatar, setAvatar] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  // A failed save, about the whole form; an unsupported avatar is the picker's own error.
  const [error, setError] = useState<{ message: string; reconnect?: boolean }>();
  const [avatarError, setAvatarError] = useState(false);
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
      if (loaded?.avatar) objectUrl = URL.createObjectURL(loaded.avatar);
      setPreview(objectUrl);
      setDraft(draftFromProfile(loaded?.profile, initialGoogleName));
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [controller, publicKey, initialGoogleName, attempt]);
  // A retry that loads the profile replaces the focused Try again with the form.
  useLayoutEffect(() => {
    if (attempt > 0 && !loading && !loadFailed) nameInput.current?.focus();
  }, [attempt, loading, loadFailed]);
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
    busy.current = true;
    setSaving(true);
    setError(undefined);
    setAvatarError(false);
    const result = await controller.save(publicKey, profileFromDraft(draft), avatar);
    busy.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (Result.isOk(result)) {
      onComplete(result.value, avatar);
      return;
    }
    // A cancelled save belongs to a connection this screen no longer shows.
    if (result.error.code === "cancelled") return;
    setError({
      message: saveErrorMessage(result.error.code),
      reconnect: result.error.code === "disconnected" && onReconnect !== undefined,
    });
  }

  const finishLater =
    required && onDefer ? (
      <Button
        className="self-center"
        disabled={saving}
        onClick={onDefer}
        type="button"
        variant="ghost"
      >
        Finish later
      </Button>
    ) : null;
  const back = backupStep ? () => setView("backup") : onBack;

  if (view === "backup")
    return (
      <ProfileBackupSteps
        identity={identity}
        actions={actions}
        onBack={onBack}
        onContinue={() => setView("profile")}
        footer={finishLater}
      />
    );

  return (
    <PassportScreen width="wide" className="gap-6">
      <div className="space-y-3">
        <DisplayHeading accent="profile." className="[&>span]:inline">
          {required ? "Create your " : "Your "}
        </DisplayHeading>
        <LeadText>Add your name, bio, links, and avatar.</LeadText>
      </div>
      {loading ? (
        <p className="flex items-center gap-2" role="status">
          <Spinner className="size-4" decorative />
          Loading your profile…
        </p>
      ) : loadFailed || !draft ? (
        <Notice tone="error">Could not load your profile. Try again before making changes.</Notice>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={(event) => void finish(event)}>
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
                  autoComplete="nickname"
                  id="profile-name"
                  ref={nameInput}
                  containerClassName="border-dashed"
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Your name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-bio">Bio</Label>
                <textarea
                  id="profile-bio"
                  className="min-h-26 w-full resize-y rounded-lg border border-dashed border-input bg-black/10 px-5 py-4 text-base leading-6 placeholder:text-muted-foreground"
                  placeholder="Tell a bit about yourself."
                  value={draft.bio}
                  onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
                />
              </div>
            </section>
            <section
              className="flex min-w-0 flex-col gap-6"
              aria-labelledby="profile-links-heading"
            >
              <h2 id="profile-links-heading" className="text-2xl font-bold leading-8">
                Links
              </h2>
              {draft.links.map((link, index) => (
                <div key={link.id} className="flex flex-col gap-2">
                  {link.fixedTitle ? (
                    <Label htmlFor={`profile-link-${link.id}`}>{link.title}</Label>
                  ) : (
                    <Input
                      aria-label={`Link ${index + 1} title`}
                      value={link.title}
                      placeholder="Link title"
                      containerClassName="h-9 border-dashed"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          links: draft.links.map((item) =>
                            item.id === link.id ? { ...item, title: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  )}
                  <Input
                    id={`profile-link-${link.id}`}
                    aria-label={link.fixedTitle ? undefined : `Link ${index + 1} URL`}
                    containerClassName="border-dashed"
                    placeholder={link.title === "X (Twitter)" ? "@user" : "https://"}
                    value={link.url}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        links: draft.links.map((item) =>
                          item.id === link.id ? { ...item, url: event.target.value } : item,
                        ),
                      })
                    }
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="size-6 p-0"
                        aria-label={`Remove ${link.title || `link ${index + 1}`}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            links: draft.links.filter((item) => item.id !== link.id),
                          })
                        }
                      >
                        <TrashIcon />
                      </Button>
                    }
                  />
                </div>
              ))}
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
                alt="Profile avatar preview"
                className="size-48 rounded-full object-cover"
                width={192}
                height={192}
                unoptimized
                src={(avatar ? filePreview : preview) ?? "/illustrations/profile-avatar.svg"}
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
                <label className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full bg-secondary px-3 text-xs font-bold text-secondary-foreground has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-foreground">
                  <Image alt="" src="/icons/profile-file.svg" width={16} height={16} /> Choose file
                  <input
                    aria-describedby={avatarError ? "profile-avatar-error" : undefined}
                    aria-invalid={avatarError || undefined}
                    aria-label="Choose avatar file"
                    className="absolute inset-0 w-full cursor-pointer opacity-0"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      // The error stays by the picker, which keeps focus for another choice.
                      if (!isAvatarFile(file)) {
                        setAvatarError(true);
                        return;
                      }
                      setAvatar(file);
                      setAvatarError(false);
                      setError(undefined);
                    }}
                  />
                </label>
              )}
              {avatarError ? (
                <FieldMessage className="text-center" error id="profile-avatar-error">
                  {INVALID_AVATAR_MESSAGE}
                </FieldMessage>
              ) : null}
            </section>
          </fieldset>
          {error ? (
            <Notice focusOnMount tone="error">
              {error.message}
              {error.reconnect ? (
                <Button type="button" size="sm" variant="secondary" onClick={onReconnect}>
                  Connect Ring
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <p className="text-sm text-muted-foreground">Your profile is public.</p>
          <div className="flex items-center justify-between gap-3">
            <BackButton className="w-[120px]" disabled={saving} onClick={back} />
            <Button loading={saving} size="lg" type="submit" className="min-w-32">
              <ArrowRightIcon />
              {unreadable
                ? saving
                  ? "Replacing…"
                  : "Replace profile"
                : saving
                  ? "Saving…"
                  : "Finish"}
            </Button>
          </div>
          {finishLater}
        </form>
      )}
      {loading || loadFailed ? (
        <>
          <PassportNavigation
            back={<BackButton onClick={back} />}
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
          />
          {finishLater}
        </>
      ) : null}
    </PassportScreen>
  );
}
