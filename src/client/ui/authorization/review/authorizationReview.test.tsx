/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { AuthorizationReview } from "./authorizationReview";

const IDENTITY = { publicIdentity: { publicKeyZ32: "public-key" } };
const CHAT = {
  path: "/priv/chat/v1/",
  read: true,
  write: true,
  encrypt: true,
  scope: "specific",
} as const;
const PUBLIC_KEYS = {
  path: "/pub/chat/",
  read: false,
  write: false,
  encrypt: true,
  scope: "specific",
} as const;

function props(capabilities: AuthorizationRequestReview["capabilities"]) {
  return {
    identity: IDENTITY,
    onAuthorize: vi.fn(),
    onCancel: vi.fn(),
    onManage: vi.fn(),
    onSwitch: vi.fn(),
    phase: "review" as const,
    review: {
      authenticationMethod: "grant" as const,
      callbackHost: "chat.example",
      capabilities,
    },
  };
}

afterEach(cleanup);

describe("AuthorizationReview encryption consent", () => {
  it("shows separate encryption controls for each requested scope and explains permanent sharing", () => {
    render(<AuthorizationReview {...props([CHAT, PUBLIC_KEYS])} />);

    expect(screen.getAllByText("Encrypt and decrypt content")).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Encrypt and decrypt content /priv/chat/v1/" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Encrypt and decrypt content /pub/chat/" }),
    ).toBeChecked();
    expect(screen.getByText("Read,write")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.getByText(/including future content.*cannot be revoked/u)).toBeInTheDocument();
    expect(screen.getByText(/will share encryption keys with chat\.example/u)).toBeInTheDocument();
  });

  it("declines encryption without changing storage and sends only the declined paths", async () => {
    const user = userEvent.setup();
    const reviewProps = props([CHAT, PUBLIC_KEYS]);
    render(<AuthorizationReview {...reviewProps} />);

    await user.click(screen.getByRole("checkbox", { name: /\/priv\/chat\/v1\//u }));

    expect(screen.getByText("Read,write")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /\/pub\/chat\//u })).toBeChecked();
    await user.dblClick(screen.getByRole("button", { name: "Authorize" }));

    expect(reviewProps.onAuthorize).toHaveBeenCalledExactlyOnceWith(["/priv/chat/v1/"]);
    expect(screen.getByRole("button", { name: "Authorize" })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
  });

  it("allows an encryption-only request to be approved with no keys or storage", async () => {
    const user = userEvent.setup();
    const reviewProps = props([PUBLIC_KEYS]);
    render(<AuthorizationReview {...reviewProps} />);

    await user.click(screen.getByRole("checkbox"));

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("Write")).not.toBeInTheDocument();
    expect(screen.getByText(/No encryption keys will be shared/u)).toBeInTheDocument();
    expect(screen.queryByText(/will share encryption keys/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(reviewProps.onAuthorize).toHaveBeenCalledWith(["/pub/chat/"]);
  });

  it.each(["preparing", "granting", "completing"] as const)(
    "locks encryption choices during %s",
    async (phase) => {
      const user = userEvent.setup();
      const reviewProps = props([CHAT]);
      render(<AuthorizationReview {...reviewProps} phase={phase} />);

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeDisabled();
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(reviewProps.onAuthorize).not.toHaveBeenCalled();
    },
  );

  it("does not imply storage read and write share encryption keys", () => {
    render(<AuthorizationReview {...props([{ ...CHAT, encrypt: false }])} />);

    expect(screen.getByText("Read,write")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/encryption key/iu)).not.toBeInTheDocument();
  });

  it("keeps an empty permissions request usable", async () => {
    const user = userEvent.setup();
    const reviewProps = props([]);
    render(<AuthorizationReview {...reviewProps} />);

    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(reviewProps.onAuthorize).toHaveBeenCalledWith([]);
  });

  it("uses one consent choice for duplicate encryption scopes", async () => {
    const user = userEvent.setup();
    const reviewProps = props([CHAT, { ...CHAT, write: false }]);
    render(<AuthorizationReview {...reviewProps} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(reviewProps.onAuthorize).toHaveBeenCalledWith(["/priv/chat/v1/"]);
  });

  it("declines covering folder keys when a nested scope is declined", async () => {
    const user = userEvent.setup();
    const reviewProps = props([
      { ...PUBLIC_KEYS, path: "/pub/" },
      PUBLIC_KEYS,
      { ...PUBLIC_KEYS, path: "/pub/other/" },
    ]);
    render(<AuthorizationReview {...reviewProps} />);
    const parent = screen.getByRole("checkbox", { name: "Encrypt and decrypt content /pub/" });
    const child = screen.getByRole("checkbox", { name: "Encrypt and decrypt content /pub/chat/" });
    const sibling = screen.getByRole("checkbox", {
      name: "Encrypt and decrypt content /pub/other/",
    });

    await user.click(child);

    expect(child).not.toBeChecked();
    expect(parent).not.toBeChecked();
    expect(sibling).toBeChecked();
    expect(screen.getByText(/A folder key also covers its contents/u)).toBeInTheDocument();
    await user.click(parent);
    expect(parent).toBeChecked();
    expect(child).toBeChecked();
    await user.click(child);
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(reviewProps.onAuthorize).toHaveBeenCalledWith(["/pub/", "/pub/chat/"]);
  });

  it("can share a narrower key while declining only its parent", async () => {
    const user = userEvent.setup();
    const reviewProps = props([{ ...PUBLIC_KEYS, path: "/" }, PUBLIC_KEYS]);
    render(<AuthorizationReview {...reviewProps} />);

    await user.click(screen.getByRole("checkbox", { name: "Encrypt and decrypt content /" }));

    expect(screen.getByRole("checkbox", { name: /\/pub\/chat\//u })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Authorize" }));
    expect(reviewProps.onAuthorize).toHaveBeenCalledWith(["/"]);
  });

  it("does not treat a file scope as covering a similarly named path", async () => {
    const user = userEvent.setup();
    render(
      <AuthorizationReview
        {...props([
          { ...PUBLIC_KEYS, path: "/pub/chat/item" },
          { ...PUBLIC_KEYS, path: "/pub/chat/items" },
        ])}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /\/pub\/chat\/items$/u }));

    expect(screen.getByRole("checkbox", { name: /\/pub\/chat\/item$/u })).toBeChecked();
    expect(screen.queryByText(/A folder key also covers/u)).not.toBeInTheDocument();
  });
});

function identityActionProps() {
  return {
    identity: { publicIdentity: { publicKeyZ32: "identity-public-key" } },
    onAuthorize: vi.fn(),
    onCancel: vi.fn(),
    onManage: vi.fn(),
    onSwitch: vi.fn(),
    phase: "review" as const,
    review: {
      authenticationMethod: "cookie" as const,
      capabilities: [
        {
          path: "/pub/client.app/",
          read: true,
          write: true,
          encrypt: false,
          scope: "specific" as const,
        },
      ],
      callbackHost: "client.app",
    },
  };
}

describe("AuthorizationReview identity actions", () => {
  it("offers Manage and Switch as separate identity actions", async () => {
    const user = userEvent.setup();
    const reviewProps = identityActionProps();
    render(<AuthorizationReview {...reviewProps} />);
    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Switch" }));

    expect(reviewProps.onManage).toHaveBeenCalledOnce();
    expect(reviewProps.onSwitch).toHaveBeenCalledOnce();
    expect(reviewProps.onAuthorize).not.toHaveBeenCalled();
    expect(reviewProps.onCancel).not.toHaveBeenCalled();
  });

  it.each(["preparing", "granting", "completing"] as const)(
    "locks identity actions during %s",
    (phase) => {
      render(<AuthorizationReview {...identityActionProps()} phase={phase} />);
      expect(screen.getByRole("button", { name: "Manage" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
    },
  );

  it("does not allow management without a local identity", () => {
    render(<AuthorizationReview {...identityActionProps()} identity={undefined} />);
    expect(screen.getByRole("button", { name: "Manage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Authorize" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch" })).toBeEnabled();
  });
});
