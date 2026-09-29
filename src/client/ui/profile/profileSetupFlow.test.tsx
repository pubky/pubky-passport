/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { ProfileErrorCode, ProfileResult } from "@/client/logic/profile/ProfileController";
import type { LoadedProfile, PubkyProfile } from "@/client/logic/profile/profile";
import { ProfileSetupFlow } from "./profileSetupFlow";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const load = vi.fn<(key: string) => Promise<ProfileResult<LoadedProfile | null>>>();
const save =
  vi.fn<
    (key: string, profile: PubkyProfile, avatar?: File) => Promise<ProfileResult<PubkyProfile>>
  >();

/** Opened from Manage or the overview by default; `afterAddition` opens it as creation does. */
function mount(
  identity: Partial<LocalIdentityMetadata> = {},
  handlers: { onReconnect?: () => void; afterAddition?: boolean } = {},
) {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const onDefer = vi.fn();
  const { afterAddition = false, ...rest } = handlers;
  render(
    <ProfileSetupFlow
      identity={{ publicIdentity: { publicKeyZ32: KEY }, ...identity }}
      controller={{ load, save }}
      onBack={afterAddition ? undefined : onBack}
      onComplete={onComplete}
      onDefer={afterAddition ? onDefer : undefined}
      {...rest}
    />,
  );
  return { onBack, onComplete, onDefer };
}
beforeEach(() => {
  load.mockResolvedValue(Result.ok(null));
  save.mockResolvedValue(Result.ok({ name: "Satoshi" }));
  URL.createObjectURL = vi.fn(() => "blob:avatar");
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfileSetupFlow", () => {
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
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("img", { name: "Profile avatar preview" })).toHaveAttribute(
      "src",
      "blob:avatar",
    );
  });

  it.each<[ProfileErrorCode, string]>([
    [
      "invalid_profile",
      "Use a name of 3–50 characters, a bio of up to 160 characters, and valid links with titles (up to 5).",
    ],
    ["invalid_avatar", "Passport could not use this image."],
    ["identity_unavailable", "no longer available in this browser"],
    ["storage_failed", "Your profile was published"],
    ["save_failed", "Check your connection and try again."],
    ["disconnected", "Your connection to Ring has ended."],
  ])("explains a %s save failure", async (code, message) => {
    save.mockResolvedValueOnce(Result.err({ code }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    // The failure appears above the actions and takes focus, so it is not missed.
    expect(alert).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Connect Ring" })).not.toBeInTheDocument();
  });

  it("shows an unsupported avatar's error by the picker and leaves focus there", async () => {
    mount();
    const picker = await screen.findByLabelText("Choose avatar file");
    picker.focus();

    fireEvent.change(picker, {
      target: { files: [new File(["%PDF"], "avatar.pdf", { type: "application/pdf" })] },
    });

    const message = screen.getByRole("alert");
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers to reconnect Ring after the grant has ended", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "disconnected" }));
    const onReconnect = vi.fn();
    mount({ keySource: "ring" }, { onReconnect });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Connect Ring" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("stays silent about a save cancelled by its closed connection", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "cancelled" }));
    const { onComplete } = mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("button", { name: "Finish" })).toBeEnabled();
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

  it("offers Finish later as the one way on right after an identity was added", async () => {
    const { onDefer } = mount({ profileSetupRequired: true }, { afterAddition: true });
    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    // Finish later takes Back's place beside Finish, so the pinned bar stays one row.
    const finishLater = screen.getByRole("button", { name: "Finish later" });
    expect(finishLater.parentElement).toBe(
      screen.getByRole("button", { name: "Finish" }).parentElement,
    );
    await userEvent.setup().click(finishLater);
    expect(onDefer).toHaveBeenCalledOnce();
  });

  it("offers only Back, no Finish later, when required setup was opened later", async () => {
    mount({ profileSetupRequired: true });
    await screen.findByLabelText("Name");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
  });

  it("keeps focused fields clear of the actions pinned to the window", async () => {
    mount();
    await screen.findByLabelText("Name");
    // The page's scroll padding below md applies while this bar is on screen (globals.css).
    expect(
      screen.getByRole("button", { name: "Finish" }).closest("[data-sticky-actions]"),
    ).not.toBeNull();
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
    await user.type(screen.getByLabelText("Link 3 URL"), "https://github.com/satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(save).not.toHaveBeenCalled();
    expect(name).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    const expected: [HTMLElement, string][] = [
      [name, "Enter a name of 3–50 characters."],
      [screen.getByLabelText("Bio"), "Keep your bio to 160 characters (you have 161)."],
      [screen.getByLabelText("Website"), "Enter a full web address, like https://example.com."],
      [
        screen.getByLabelText("X (Twitter)"),
        "Enter an X handle, like @satoshi, or a full web address.",
      ],
      [screen.getByLabelText("Link 3 title"), "Give this link a title."],
    ];
    for (const [control, message] of expected) {
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAccessibleDescription(message);
    }
    expect(screen.getByLabelText("Link 3 URL")).not.toHaveAttribute("aria-invalid");
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
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByLabelText("Bio")).toHaveFocus();
    expect(save).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Bio"));
    await user.clear(screen.getByLabelText("Website"));
    await user.type(screen.getByLabelText("Website"), "https://alice.example");
    await user.clear(screen.getByLabelText("X (Twitter)"));
    await user.type(screen.getByLabelText("X (Twitter)"), "@alice");
    await user.click(screen.getByRole("button", { name: "Finish" }));
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
  });

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

    await user.type(screen.getByLabelText("Website"), "localhost:3000{Enter}");
    expect(status).toHaveTextContent(
      "2 fields need changes. Name: Enter a name of 3–50 characters.",
    );
    expect(save).not.toHaveBeenCalled();

    await user.type(name, "ice");
    await user.clear(screen.getByLabelText("Website"));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(save).toHaveBeenCalledOnce();
    expect(status).toBeEmptyDOMElement();
  });

  it("clears a message whose cause was fixed through another field", async () => {
    save.mockResolvedValueOnce(Result.err({ code: "save_failed" }));
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Link 3 URL"), "https://github.com/satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const title = screen.getByLabelText("Link 3 title");
    expect(title).toHaveFocus();
    expect(title).toHaveAccessibleDescription("Give this link a title.");

    // Without its URL the link is dropped, so it needs no title.
    await user.clear(screen.getByLabelText("Link 3 URL"));
    expect(title).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Give this link a title.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile.");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("clears a handle's message when its link takes the X title", async () => {
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Satoshi");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Link 3 title"), "Twitter");
    await user.type(screen.getByLabelText("Link 3 URL"), "@satoshi");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const url = screen.getByLabelText("Link 3 URL");
    expect(url).toHaveAccessibleDescription("Enter a full web address, like https://example.com.");

    await user.clear(screen.getByLabelText("Link 3 title"));
    await user.type(screen.getByLabelText("Link 3 title"), "X (Twitter)");
    expect(url).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Finish" }));
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
    await user.click(screen.getByLabelText("Link 3 title"));
    await user.paste("t".repeat(101));
    await user.click(screen.getByLabelText("Link 3 URL"));
    // 300 characters as typed; the space is stored as %20.
    await user.paste(`https://example.com/${"a".repeat(278)} b`);
    await user.click(screen.getByLabelText("Website"));
    await user.paste(`https://example.com/${"p".repeat(281)}`);
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(screen.getByLabelText("Link 3 title")).toHaveAccessibleDescription(
      "Keep this title to 100 characters or fewer (you have 101).",
    );
    expect(screen.getByLabelText("Link 3 URL")).toHaveAccessibleDescription(
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
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your profile.");
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Finish" }));
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
