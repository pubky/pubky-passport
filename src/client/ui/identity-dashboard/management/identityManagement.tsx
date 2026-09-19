import { Result } from "better-result";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  LinkOffIcon,
  LogOutIcon,
  RotateCcwIcon,
} from "@/client/ui/shared/icons";
import { shortCopiedValue } from "@/client/ui/shared/formatPublicKey";
import { BackButton } from "@/client/ui/shared/backButton";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

type HomeserverLookup =
  { status: "looking-up" } | { status: "unavailable" } | { status: "resolved"; pubky: string };

function homeserverLabel(lookup: HomeserverLookup): string {
  switch (lookup.status) {
    case "looking-up":
      return "Looking up…";
    case "resolved":
      return lookup.pubky;
    case "unavailable":
      return "Unavailable";
  }
}

function IdentityManagement({
  identity,
  onBack,
  onDetachFromGoogle,
  onDownloadRecoveryFile,
  onRemoveLocalIdentity,
  onMigrateToKeychain,
  republishHomeserver,
  resolveHomeserver,
}: {
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDetachFromGoogle: () => void;
  onDownloadRecoveryFile: () => void;
  onRemoveLocalIdentity: () => LocalIdentityResult<void>;
  onMigrateToKeychain: () => void;
  republishHomeserver: () => Promise<LocalIdentityHomeserverRepublishResult>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
}) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";
  const [homeserver, setHomeserver] = useState<HomeserverLookup>({ status: "looking-up" });
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const [republishMessage, setRepublishMessage] = useState<{ error: boolean; text: string } | null>(
    null,
  );

  function logout(): void {
    const removed = onRemoveLocalIdentity();
    if (Result.isError(removed)) {
      setLogoutFailed(true);
      return;
    }
    onBack();
  }

  async function republish(): Promise<void> {
    setRepublishing(true);
    setRepublishMessage(null);
    try {
      const published = await republishHomeserver();
      if (Result.isError(published)) {
        setRepublishMessage({
          error: true,
          text: "Could not republish the homeserver record. Please try again.",
        });
        return;
      }
      setRepublishMessage({ error: false, text: "Homeserver record republished." });
      const resolved = await resolveHomeserver(identity.publicIdentity.publicKeyZ32);
      setHomeserver(
        Result.isOk(resolved) && resolved.value
          ? { status: "resolved", pubky: resolved.value }
          : { status: "unavailable" },
      );
    } catch (e) {
      LOGGER.warn("identity.management.failed", {
        operation: "republish_homeserver",
        ...safeErrorLogFields(e),
      });
      setRepublishMessage({
        error: true,
        text: "Could not republish the homeserver record. Please try again.",
      });
    } finally {
      setRepublishing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void resolveHomeserver(identity.publicIdentity.publicKeyZ32)
      .then((result) => {
        if (!cancelled) {
          setHomeserver(
            Result.isOk(result) && result.value
              ? { status: "resolved", pubky: result.value }
              : { status: "unavailable" },
          );
        }
      })
      .catch((e: unknown) => {
        LOGGER.warn("identity.management.failed", {
          operation: "resolve_homeserver",
          ...safeErrorLogFields(e),
        });
        if (!cancelled) setHomeserver({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [identity.publicIdentity.publicKeyZ32, resolveHomeserver]);

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <Button
        className="absolute right-6 top-[26px] z-10 md:right-10 md:top-12 md:h-10 md:px-4 md:py-2 md:text-sm md:leading-5"
        onClick={logout}
        size="sm"
        variant="secondary"
      >
        <LogOutIcon />
        Log out
      </Button>

      <header className="flex items-start gap-6 md:items-center">
        <DisplayHeading accent="identity." aria-label="Manage identity.">
          Manage
        </DisplayHeading>
        <Avatar
          className="ml-auto"
          fallback={name}
          size="lg"
          src={account?.pictureUrl ?? undefined}
        />
      </header>

      <section className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-x-4 md:gap-y-6">
        <IdentityDetail label="User" value={name} />
        <IdentityDetail label="Google account" value={account?.email ?? "Not connected"} />
        <IdentityDetail
          copyable
          label="Pubky"
          onCopied={() =>
            toast.info("Pubky copied to clipboard", {
              description: shortCopiedValue(identity.publicIdentity.publicKeyZ32),
            })
          }
          value={identity.publicIdentity.publicKeyZ32}
        />
        <IdentityDetail
          copyable={homeserver.status === "resolved"}
          label="Homeserver"
          onCopied={() => toast.info("Homeserver copied")}
          value={homeserverLabel(homeserver)}
        />
      </section>

      <div className="mt-auto flex flex-col gap-4 pt-6 md:mt-0 md:flex-row md:flex-wrap md:gap-3 md:pt-0">
        {logoutFailed ? (
          <FieldMessage error>Could not log out. Please try again.</FieldMessage>
        ) : null}
        {republishMessage ? (
          <FieldMessage error={republishMessage.error}>{republishMessage.text}</FieldMessage>
        ) : null}
        {homeserver.status === "unavailable" ? (
          <ManagementButton
            disabled={republishing}
            icon={<RotateCcwIcon />}
            onClick={() => {
              void republish();
            }}
          >
            Republish homeserver
          </ManagementButton>
        ) : null}
        <ManagementButton icon={<KeyRoundIcon />} onClick={onMigrateToKeychain}>
          Migrate to keychain
        </ManagementButton>
        <ManagementButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>
          Download backup
        </ManagementButton>
        {account ? (
          <ManagementButton icon={<LinkOffIcon />} onClick={onDetachFromGoogle}>
            Detach from Google
          </ManagementButton>
        ) : null}
      </div>
      <PassportNavigation back={<BackButton onClick={onBack} />} className="mt-0 pt-0 md:pt-1" />
    </PassportScreen>
  );
}

function IdentityDetail({
  copyable = false,
  label,
  onCopied,
  value,
}: {
  copyable?: boolean;
  label: string;
  onCopied?: () => void;
  value: string;
}) {
  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      onCopied?.();
    } catch (e) {
      LOGGER.info("identity.management.failed", {
        operation: "copy",
        ...safeErrorLogFields(e),
      });
    }
  }

  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p className={cn("break-all font-medium leading-6", onCopied && "md:text-sm md:leading-5")}>
          {value}
        </p>
      </div>
      {onCopied ? (
        <IconButton
          aria-label={`Copy ${label}`}
          className="size-9 p-1"
          disabled={!copyable}
          onClick={() => {
            void copyValue();
          }}
          variant="ghost"
        >
          <CopyIcon size={20} />
        </IconButton>
      ) : null}
    </div>
  );
}

function ManagementButton({
  children,
  disabled,
  icon,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button
      className="w-full md:h-10 md:min-w-0 md:flex-1 md:px-4 md:py-2"
      disabled={disabled}
      onClick={onClick}
      size="lg"
      variant="secondary"
    >
      {icon}
      {children}
    </Button>
  );
}

export { IdentityManagement };
