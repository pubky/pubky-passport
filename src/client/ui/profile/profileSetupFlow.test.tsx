/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileErrorCode, ProfileResult } from "@/client/logic/profile/ProfileController";
import type { LoadedProfile, PubkyProfile } from "@/client/logic/profile/profile";
import { checkLinkUrls } from "@/client/logic/profile/ProfileSpecsAdapter";
import { draftFromProfile, type UnsavedProfileEdits } from "@/client/logic/profile/profileDraft";
import { ProfileSetupFlow } from "./profileSetupFlow";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const load = vi.fn<(key: string) => Promise<ProfileResult<LoadedProfile | null>>>();
const save =
  vi.fn<
    (key: string, profile: PubkyProfile, avatar?: File) => Promise<ProfileResult<PubkyProfile>>
  >();
const checkAvatar = vi.fn<(file: File) => Promise<ProfileResult<void>>>();
const GOOGLE_ACCOUNT = {
  name: "Alice Example",
  email: "alice@example.com",
  googleSubject: "subject",
  pictureUrl: null,
};

/** Opened from Manage or the overview by default; `afterAddition` opens it as creation does. */
function mount(
  identity: Partial<LocalIdentityMetadata> = {},
  handlers: {
    onReconnect?: (edits: UnsavedProfileEdits) => void;
    keptEdits?: UnsavedProfileEdits;
    afterAddition?: boolean;
    created?: boolean;
    forRequest?: boolean;
  } = {},
) {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const onDefer = vi.fn();
  const { afterAddition = false, ...rest } = handlers;
  render(
    <ProfileSetupFlow
      identity={{ publicIdentity: { publicKeyZ32: KEY }, ...identity }}
      controller={{ load, save, checkAvatar }}
      onBack={afterAddition ? undefined : onBack}
      onComplete={onComplete}
      onDefer={afterAddition ? onDefer : undefined}
      {...rest}
    />,
  );
  return { onBack, onComplete, onDefer };
}

/** A field of an added link, found by its group ("Link 3") and its own visible label. */
function linkField(number: number, label: "Title" | "Address"): HTMLElement {
  return within(screen.getByRole("group", { name: `Link ${number}` })).getByLabelText(label);
}

function pick(picker: HTMLElement, file: File) {
  fireEvent.change(picker, { target: { files: [file] } });
}
beforeEach(() => {
  load.mockResolvedValue(Result.ok(null));
  save.mockResolvedValue(Result.ok({ name: "Satoshi" }));
  checkAvatar.mockResolvedValue(Result.ok(undefined));
  URL.createObjectURL = vi.fn(() => "blob:avatar");
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSetupFlow", () => {
  // A save first asks the specs WASM about each link address; loading it once here keeps each
  // save's check as quick as a click, as it is once the app has loaded it.
  beforeAll(async () => {
    await checkLinkUrls(["https://example.com"]);
  });

  it("opens an empty form over an unreadable published profile and says saving replaces it", async () => {
    load.mockResolvedValue(Result.err({ code: "invalid_profile" }));
    const { onComplete } = mount({
      googleAccount: {
        name: "Google name",
        email: "google@example.com",
        googleSubject: "subject",
        pictureUrl: null,
      },
    });
    expect(await screen.findByLabelText("Name")).toHaveValue("Google name");
    // The form's own status line (refused Finish announcements) is empty; the warning is found by
    // its tone.
    const warning = screen
      .getByText("We couldn’t read your current profile.")
      .closest("[data-tone]");
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveTextContent("Saving here replaces it everywhere it’s shown.");
    // The button says it overwrites what other apps show, not just that setup ends.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Replace profile" }));
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ name: "Google name" }),
      undefined,
    );
    expect(onComplete).toHaveBeenCalledWith({ name: "Satoshi" }, undefined);
  });

  it("shows only a retry for a failed read", async () => {
    load.mockResolvedValueOnce(Result.err({ code: "load_failed" }));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load your profile/u);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    // The retry is the primary action beside Back, not a small pill above it.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Back",
      "Try again",
    ]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    // The form replaces the focused retry, so focus moves into it rather than to the page.
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("");
    expect(name).toHaveFocus();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed retry's button focused and busy while it runs", async () => {
    let failAgain!: () => void;
    load.mockResolvedValueOnce(Result.err({ code: "load_failed" })).mockReturnValueOnce(
      new Promise((resolve) => {
        failAgain = () => resolve(Result.err({ code: "load_failed" }));
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your profile…");
    await act(async () => failAgain());
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load your profile/u);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });

  it("previews an existing avatar from its downloaded bytes", async () => {
    load.mockResolvedValue(
      Result.ok({ profile: { name: "Satoshi" }, avatar: new Blob(["png"], { type: "image/png" }) }),
    );
    mount();
    expect(await screen.findByRole("img", { name: "Your avatar" })).toHaveAttribute(
      "src",
      "blob:avatar",
    );
  });

  it("gives the placeholder no name, and returns to it when an avatar cannot be drawn", async () => {
    load.mockResolvedValue(
      Result.ok({
        profile: { name: "Satoshi", image: `pubky://${KEY}/pub/pubky.app/files/AVATAR` },
        avatar: new Blob(["png"], { type: "image/png" }),
      }),
    );
    mount();
    const avatar = await screen.findByRole("img", { name: "Your avatar" });
    // A grey circle while it loads, not an empty square with its alt text.
    expect(avatar).toHaveClass("bg-muted", "rounded-full");
    fireEvent.error(avatar);
    expect(screen.queryByRole("img", { name: "Your avatar" })).not.toBeInTheDocument();
    expect(avatar).toHaveAttribute("alt", "");
    expect(avatar.getAttribute("src")).toMatch(/profile-avatar\.svg$/u);
    // The published avatar is still there to delete.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it.each<[ProfileErrorCode, string]>([
    [
      "invalid_profile",
      "Use a name of 3–50 characters, a bio of up to 160 characters, and valid links with titles (up to 5).",
    ],
    ["identity_unavailable", "no longer available in this browser"],
    ["storage_failed", "Your profile was published"],
    ["save_failed", "Check your connection and try again."],
    ["disconnected", "Your connection to Pubky Ring has ended. Connect Pubky Ring again"],
  ])("explains a %s save failure", async (code, message) => {
    save.mockResolvedValueOnce(Result.err({ code }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    // The failure appears above the actions and takes focus, so it is not missed.
    expect(alert).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Reconnect Pubky Ring" })).not.toBeInTheDocument();
  });

  it("shows an unsupported avatar's error by the picker and leaves focus there", async () => {
    mount();
    const picker = await screen.findByLabelText("Choose avatar file");
    picker.focus();

    fireEvent.change(picker, {
      target: { files: [new File(["%PDF"], "avatar.pdf", { type: "application/pdf" })] },
    });

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent("Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.");
    expect(picker).toHaveAccessibleDescription(
      "Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
    );
    expect(picker).toHaveAttribute("aria-invalid", "true");
    // A field error is not a failed save: focus stays on the picker for another choice.
    expect(picker).toHaveFocus();
    expect(message.closest("section")).toBe(screen.getByRole("region", { name: "Avatar" }));

    fireEvent.change(picker, {
      target: { files: [new File(["png"], "avatar.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("names the formats under the picker and refuses a damaged image when it is picked", async () => {
    checkAvatar.mockResolvedValueOnce(Result.err({ code: "invalid_avatar" }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    const picker = screen.getByLabelText("Choose avatar file");
    expect(picker).toHaveAccessibleDescription("PNG, JPEG, WebP, or GIF, up to 5 MB.");
    const damaged = new File(["not an image"], "holiday.png", { type: "image/png" });
    pick(picker, damaged);

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent(
      "This image can’t be opened. Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
    );
    expect(checkAvatar).toHaveBeenCalledWith(damaged);
    expect(message.closest("section")).toBe(screen.getByRole("region", { name: "Avatar" }));
    // The avatar stays as it was: no broken preview, nothing to delete, nothing saved with it.
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Your avatar" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(KEY, expect.objectContaining({ name: "Satoshi" }), undefined);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("uses only the file picked last when an earlier check settles later", async () => {
    let settleFirst!: (result: ProfileResult<void>) => void;
    checkAvatar
      .mockReturnValueOnce(
        new Promise((resolve) => {
          settleFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(Result.ok(undefined));
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    const picker = screen.getByLabelText("Choose avatar file");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });
    pick(picker, first);
    pick(picker, second);
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
    await act(async () => settleFirst(Result.err({ code: "invalid_avatar" })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(KEY, expect.anything(), second);
  });

  it("says at the picker when a save refuses the chosen image", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "invalid_avatar" }));
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    pick(
      screen.getByLabelText("Choose avatar file"),
      new File(["png"], "a.png", { type: "image/png" }),
    );
    await screen.findByRole("button", { name: "Delete" });
    await user.click(screen.getByRole("button", { name: "Save" }));

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent("This image can’t be opened.");
    expect(message.closest("section")).toBe(screen.getByRole("region", { name: "Avatar" }));
    expect(screen.getByLabelText("Choose avatar file")).toHaveAttribute("aria-invalid", "true");
  });

  it("makes reconnecting Ring the way on after the grant ended, keeping the edits", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "disconnected" }));
    const onReconnect = vi.fn();
    mount({ keySource: "ring" }, { onReconnect });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Carol");
    const avatar = new File(["png"], "carol.png", { type: "image/png" });
    pick(screen.getByLabelText("Choose avatar file"), avatar);
    await screen.findByRole("button", { name: "Delete" });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your connection to Pubky Ring ended before your changes were saved. Reconnect Pubky Ring to publish them. Your edits are kept.",
    );
    // Saving cannot work until Ring is connected again, so Save gives way to reconnecting.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect Pubky Ring" }));
    expect(onReconnect).toHaveBeenCalledWith({
      draft: expect.objectContaining({ name: "Carol" }),
      avatar,
    });
  });

  it("keeps reconnecting as the way on when an avatar is chosen after the grant ended", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "disconnected" }));
    const onReconnect = vi.fn();
    mount({ keySource: "ring" }, { onReconnect });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Carol");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");

    const avatar = new File(["png"], "carol.png", { type: "image/png" });
    pick(screen.getByLabelText("Choose avatar file"), avatar);
    await screen.findByRole("button", { name: "Delete" });
    // A new avatar does not bring Pubky Ring back: saving would only fail again.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your connection to Pubky Ring ended before your changes were saved.",
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect Pubky Ring" }));
    expect(onReconnect).toHaveBeenCalledWith({
      draft: expect.objectContaining({ name: "Carol" }),
      avatar,
    });
  });

  it("clears a failed save's message once a new avatar is chosen", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "save_failed" }));
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    pick(
      screen.getByLabelText("Choose avatar file"),
      new File(["png"], "a.png", { type: "image/png" }),
    );
    await screen.findByRole("button", { name: "Delete" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves a chosen image once its check passes when Save is pressed meanwhile", async () => {
    let settle!: (result: ProfileResult<void>) => void;
    checkAvatar.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    const avatar = new File(["png"], "satoshi.png", { type: "image/png" });
    pick(screen.getByLabelText("Choose avatar file"), avatar);
    await user.click(screen.getByRole("button", { name: "Save" }));
    // The press is taken: the save waits for the check, busy, instead of doing nothing.
    const busy = screen.getByRole("button", { name: /Publishing/u });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(save).not.toHaveBeenCalled();

    await act(async () => settle(Result.ok(undefined)));
    expect(save).toHaveBeenCalledWith(KEY, expect.objectContaining({ name: "Satoshi" }), avatar);
    expect(onComplete).toHaveBeenCalledWith({ name: "Satoshi" }, avatar);
  });

  it("stops a save pressed while the chosen image is checked when the check refuses it", async () => {
    let settle!: (result: ProfileResult<void>) => void;
    checkAvatar.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    pick(
      screen.getByLabelText("Choose avatar file"),
      new File(["broken"], "broken.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => settle(Result.err({ code: "invalid_avatar" })));

    // Nothing is published with or without the image; the picker says why and offers another.
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("This image can’t be opened.");
    expect(screen.getByLabelText("Choose avatar file")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("reopens with the edits kept across a reconnect, over the published profile", async () => {
    load.mockResolvedValue(
      Result.ok({
        profile: {
          name: "Carol",
          bio: "Keeps her keys on her phone.",
          image: `pubky://${KEY}/pub/pubky.app/files/AVATAR`,
          links: [{ title: "Website", url: "https://carol.example/" }],
          status: null,
        },
        avatar: new Blob(["png"], { type: "image/png" }),
      }),
    );
    const published = draftFromProfile(
      { name: "Carol", links: [{ title: "Website", url: "https://carol.example/" }] },
      "",
    );
    const avatar = new File(["png"], "carol.png", { type: "image/png" });
    const keptEdits = {
      draft: {
        ...published,
        name: "Carol Danvers",
        bio: "Pilot.",
        links: [
          ...published.links,
          { id: 5, title: "Blog", url: "https://blog.example/", fixedTitle: false },
        ],
      },
      avatar,
    };
    const { onBack } = mount({ keySource: "ring" }, { keptEdits });
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Name")).toHaveValue("Carol Danvers");
    expect(screen.getByLabelText("Bio")).toHaveValue("Pilot.");
    expect(linkField(2, "Title")).toHaveValue("Blog");
    expect(
      screen.getByText(
        "Pubky Ring is connected again. Your changes are still here. Save to publish them.",
      ),
    ).toBeInTheDocument();
    // Nothing is published until the person saves; a new link does not reuse a kept id.
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(linkField(3, "Title")).toHaveAttribute("id", "profile-link-6-title");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ name: "Carol Danvers", bio: "Pilot." }),
      avatar,
    );
    // The kept edits differ from what is published, so leaving still asks first.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("stays silent about a save cancelled by its closed connection", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "cancelled" }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([
    ["a browser key", {}],
    [
      "a Google-backed identity",
      {
        googleAccount: {
          name: "Google name",
          email: "google@example.com",
          googleSubject: "subject",
          pictureUrl: null,
        },
      },
    ],
  ])("leaves required setup of %s straight away, without a backup detour", async (_, extra) => {
    const { onBack } = mount({ profileSetupRequired: true, ...extra });
    await screen.findByLabelText("Name");
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "Choose backup method" })).not.toBeInTheDocument();
  });

  it("offers Skip for now as the one way on right after an identity was added", async () => {
    const { onDefer } = mount({ profileSetupRequired: true }, { afterAddition: true });
    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    // A full button in Back's empty place: first in the row, with the save last.
    const finish = screen.getByRole("button", { name: "Save profile" });
    const finishLater = screen.getByRole("button", { name: "Skip for now" });
    expect(finishLater).toHaveClass("border-border", "min-h-15");
    expect(
      finishLater.compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Both are pinned to a phone's or the popup's window, so the way on without a profile is in
    // view without scrolling past the whole form (e2e/profile.spec.ts measures it). One row.
    const bar = finish.closest("[data-sticky-actions]");
    expect(bar).not.toBeNull();
    expect(finishLater.closest("[data-sticky-actions]")).toBe(bar);
    expect(finishLater.closest('[data-slot="tertiary-actions"]')).toBeNull();
    expect(finishLater.parentElement?.parentElement).toHaveClass("grid-cols-[auto_minmax(0,1fr)]");
    await userEvent.setup().click(finishLater);
    expect(onDefer).toHaveBeenCalledOnce();
  });

  it("says setup is optional and editing publishes, with Back before the primary", async () => {
    mount({ profileSetupRequired: true });
    await screen.findByLabelText("Name");
    // Said before anything is filled in, not in small print under the form.
    expect(
      screen.getByText(
        "Optional. Add a name, bio, links, and avatar. Anyone can see your profile, including apps you sign in to.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your profile is public.")).not.toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Back" });
    const finish = screen.getByRole("button", { name: "Save profile" });
    expect(back.compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Back keeps the shared navigation's width, not a narrower one of its own.
    expect(back).not.toHaveClass("w-[120px]");
    cleanup();

    mount();
    await screen.findByLabelText("Name");
    expect(
      screen.getByText("Changes are published to your public profile when you save."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("asks before Back throws unpublished changes away", async () => {
    const { onBack } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Back" }));

    const dialog = screen.getByRole("dialog", { name: "Discard your changes?" });
    expect(dialog).toHaveAccessibleDescription(
      "Your changes are not published yet. Leaving now throws them away.",
    );
    // Keeping the edits is the default: it comes first and has focus.
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Satoshi");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("says a deleted avatar is only removed once saved", async () => {
    load.mockResolvedValueOnce(
      Result.ok({
        profile: {
          name: "Satoshi",
          bio: null,
          image: `pubky://${KEY}/pub/pubky.app/files/AVATAR`,
          links: [],
          status: null,
        },
        avatar: new Blob(["png"], { type: "image/png" }),
      }),
    );
    const { onBack } = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(screen.getByText("Your avatar is removed when you save.")).toBeInTheDocument();
    // Removing it is a change like any other, so leaving asks first.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("says a new browser-held account exists before asking for its profile", async () => {
    const { onDefer } = mount(
      { profileSetupRequired: true },
      { afterAddition: true, created: true },
    );
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "Account created." })).toBeInTheDocument();
    expect(screen.getByText(/Your key is saved in this browser/u)).toBeInTheDocument();
    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Your pubky" })).toBeEnabled();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    // Skipping comes first, as Back would; the profile is the way on.
    const skip = screen.getByRole("button", { name: "Skip for now" });
    const add = screen.getByRole("button", { name: "Add a public profile" });
    expect(skip.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(add);
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your profile." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onDefer).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "says that skipping continues the waiting sign-in only during a request, request=%s",
    (forRequest) => {
      mount({ profileSetupRequired: true }, { afterAddition: true, created: true, forRequest });
      expect(
        screen.queryByText(/Add a profile now, or skip it and continue signing in\./u) !== null,
      ).toBe(forRequest);
    },
  );

  it("skips the profile from the Account created moment", async () => {
    const { onDefer } = mount(
      { profileSetupRequired: true },
      { afterAddition: true, created: true },
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onDefer).toHaveBeenCalledOnce();
  });

  it("has no Account created moment without a way to skip the profile", async () => {
    mount({ profileSetupRequired: true }, { created: true });
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Account created." })).not.toBeInTheDocument();
  });

  it("says a name filled in from Google is public until it is changed", async () => {
    mount({ profileSetupRequired: true, googleAccount: GOOGLE_ACCOUNT });
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Alice Example");
    expect(name).toHaveAccessibleDescription(
      "From your Google account. Change it if you don’t want it public. 3–50 characters. Shown publicly.",
    );
    await user.type(name, "!");
    expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
    expect(screen.queryByText(/From your Google account/u)).not.toBeInTheDocument();
  });

  it("does not flag a published name that matches the Google account", async () => {
    load.mockResolvedValue(Result.ok({ profile: { name: "Alice Example" } }));
    mount({ googleAccount: GOOGLE_ACCOUNT });
    expect(await screen.findByLabelText("Name")).toHaveValue("Alice Example");
    expect(screen.queryByText(/From your Google account/u)).not.toBeInTheDocument();
  });

  it("disables Bio with the other fields while saving", async () => {
    let finishSave!: () => void;
    save.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = () => resolve(Result.ok({ name: "Satoshi" }));
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    const bio = screen.getByLabelText("Bio");
    // The shared multi-line field, described by its counter.
    expect(bio.tagName).toBe("TEXTAREA");
    expect(bio).toHaveAccessibleDescription("0 of 160 characters");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(bio).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    await act(async () => finishSave());
  });

  it("labels both fields of an added link and names the link its remove button removes", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    const link = screen.getByRole("group", { name: "Link 3" });
    const title = within(link).getByLabelText("Title");
    const address = within(link).getByLabelText("Address");
    // Visible labels name the fields, so none is left to a placeholder or a hidden label.
    expect(title).not.toHaveAttribute("aria-label");
    expect(address).not.toHaveAttribute("aria-label");
    expect(within(link).getByText("Title", { selector: "label" })).toBeVisible();
    expect(within(link).getByRole("button", { name: "Remove link 3" })).toBeInTheDocument();
    await user.type(title, "GitHub");
    expect(
      within(link).getByRole("button", { name: "Remove link 3 (GitHub)" }),
    ).toBeInTheDocument();
    // The standard links keep their own label and remove button.
    expect(screen.getByRole("button", { name: "Remove Website" })).toBeInTheDocument();
  });

  it("offers only Back, no Skip for now, when required setup was opened later", async () => {
    mount({ profileSetupRequired: true });
    await screen.findByLabelText("Name");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
  });

  it("keeps focused fields clear of the actions pinned to the window", async () => {
    mount();
    await screen.findByLabelText("Name");
    // The page's scroll padding below md applies while this bar is on screen (globals.css).
    const save = screen.getByRole("button", { name: "Save" });
    const bar = save.closest("[data-sticky-actions]");
    expect(bar).not.toBeNull();
    // Back and Save share one row at every width, so the bar stays short over the form.
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.closest("[data-sticky-actions]")).toBe(bar);
    expect(back.parentElement?.parentElement).toHaveClass("grid-cols-[auto_minmax(0,1fr)]");
    expect(save.parentElement).toHaveClass("col-start-2");
  });

  it("goes straight back when editing a finished profile", async () => {
    const { onBack } = mount();
    await screen.findByLabelText("Name");
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows the name and bio limits before anything is typed", async () => {
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    const bio = screen.getByLabelText("Bio");
    expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
    // Required for assistive technology, without the browser's own fading bubble.
    expect(name).toHaveAttribute("aria-required", "true");
    expect(name).not.toHaveAttribute("required");
    expect(bio).toHaveAccessibleDescription("0 of 160 characters");
    expect(screen.getByText("0/160")).toBeVisible();

    await user.click(bio);
    await user.paste(`${"b".repeat(160)}  `);
    // Counted as the specification counts: trailing spaces are trimmed away.
    expect(bio).toHaveAccessibleDescription("160 of 160 characters");
    expect(bio).not.toHaveAttribute("aria-invalid");
    await user.type(bio, "!");
    expect(bio).toHaveAccessibleDescription("163 of 160 characters");
    expect(bio).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("163/160").closest("p")).toHaveClass("text-destructive-text");
    // The counter changes with every keystroke, so it is not an alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks each invalid field where it is, focuses the first and saves nothing", async () => {
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.type(name, "Al");
    await user.click(screen.getByLabelText("Bio"));
    await user.paste("b".repeat(161));
    await user.type(screen.getByLabelText("Website"), "my website");
    await user.type(screen.getByLabelText("X (Twitter)"), "@satoshi nakamoto");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(linkField(3, "Address"), "https://github.com/satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(save).not.toHaveBeenCalled();
    expect(name).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    const expected: [HTMLElement, string][] = [
      [name, "Enter a name of 3–50 characters."],
      [screen.getByLabelText("Bio"), "Keep your bio to 160 characters (you have 161)."],
      [
        screen.getByLabelText("Website"),
        "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.",
      ],
      [
        screen.getByLabelText("X (Twitter)"),
        "Enter an X handle, like @satoshi, or a full web address.",
      ],
      [linkField(3, "Title"), "Give this link a title."],
    ];
    for (const [control, message] of expected) {
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAccessibleDescription(message);
    }
    expect(linkField(3, "Address")).not.toHaveAttribute("aria-invalid");
    // Focus reads the first message out; the others are read as each field is reached.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Changing a field clears its own message only.
    await user.type(name, "ice");
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
    expect(screen.getByLabelText("Website")).toHaveAttribute("aria-invalid", "true");
    // Removing a link clears its messages with it.
    await user.click(screen.getByRole("button", { name: "Remove link 3" }));
    expect(screen.queryByText("Give this link a title.")).not.toBeInTheDocument();

    // Finish again focuses the first field still marked.
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Bio")).toHaveFocus();
    expect(save).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Bio"));
    await user.clear(screen.getByLabelText("Website"));
    await user.type(screen.getByLabelText("Website"), "https://alice.example");
    await user.clear(screen.getByLabelText("X (Twitter)"));
    await user.type(screen.getByLabelText("X (Twitter)"), "@alice");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({
        name: "Alice",
        links: [
          { title: "Website", url: "https://alice.example" },
          { title: "X (Twitter)", url: "https://x.com/alice" },
        ],
      }),
      undefined,
    );
  }, 15_000);

  it("says why Finish was refused when Enter submits from the field already focused", async () => {
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    // Focus cannot move to the field it is on, so the reason is spoken instead.
    await user.type(name, "Al{Enter}");
    expect(save).not.toHaveBeenCalled();
    expect(name).toHaveFocus();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "1 field needs a change. Name: Enter a name of 3–50 characters.",
    );
    // The same refusal again is a new announcement, not an unchanged region.
    const announcement = status.firstElementChild;
    await user.keyboard("{Enter}");
    expect(status.firstElementChild).not.toBe(announcement);
    expect(status).toHaveTextContent("1 field needs a change.");

    await user.type(screen.getByLabelText("Website"), "my website{Enter}");
    expect(status).toHaveTextContent(
      "2 fields need changes. Name: Enter a name of 3–50 characters.",
    );
    expect(save).not.toHaveBeenCalled();

    await user.type(name, "ice");
    await user.clear(screen.getByLabelText("Website"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledOnce();
    expect(status).toBeEmptyDOMElement();
  });

  it("clears a message whose cause was fixed through another field", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "save_failed" }));
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(linkField(3, "Address"), "https://github.com/satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const title = linkField(3, "Title");
    expect(title).toHaveFocus();
    expect(title).toHaveAccessibleDescription("Give this link a title.");

    // Without its URL the link is dropped, so it needs no title.
    await user.clear(linkField(3, "Address"));
    expect(title).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Give this link a title.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile.");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("clears a handle's message when its link takes the X title", async () => {
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(linkField(3, "Title"), "Twitter");
    await user.type(linkField(3, "Address"), "@satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const url = linkField(3, "Address");
    expect(url).toHaveAccessibleDescription(
      "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.",
    );

    await user.clear(linkField(3, "Title"));
    await user.type(linkField(3, "Title"), "X (Twitter)");
    expect(url).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({
        links: [{ title: "X (Twitter)", url: "https://x.com/satoshi" }],
      }),
      undefined,
    );
  });

  it("gives the length of an overlong link title and address, as the specs count it", async () => {
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.click(linkField(3, "Title"));
    await user.paste("t".repeat(101));
    await user.click(linkField(3, "Address"));
    // 300 characters as typed; the space is stored as %20.
    await user.paste(`https://example.com/${"a".repeat(278)} b`);
    await user.click(screen.getByLabelText("Website"));
    await user.paste(`https://example.com/${"p".repeat(281)}`);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(linkField(3, "Title")).toHaveAccessibleDescription(
      "Keep this title to 100 characters or fewer (you have 101).",
    );
    expect(linkField(3, "Address")).toHaveAccessibleDescription(
      "Keep this address to 300 characters or fewer (it is 302 once encoded).",
    );
    expect(screen.getByLabelText("Website")).toHaveAccessibleDescription(
      "Keep this address to 300 characters or fewer (you have 301).",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("replaces a failed save's message with the fields to fix", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "save_failed" }));
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.type(name, "Satoshi");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile.");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription("Enter a name of 3–50 characters.");
    expect(save).toHaveBeenCalledOnce();
  });

  it("caps links at the specification's limit", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Name");
    for (let added = 0; added < 3; added++)
      await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.queryByRole("button", { name: "Add link" })).not.toBeInTheDocument();
  });
});
