import { toast } from "sonner";

function showPubkyCopied(value: string) {
  toast("Pubky copied to clipboard", { description: shortCopiedValue(value) });
}

function showHomeserverCopied() {
  toast("Homeserver copied");
}

function showFileDownloaded() {
  toast.success("File downloaded");
}

function shortCopiedValue(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}...` : value;
}

export { showFileDownloaded, showHomeserverCopied, showPubkyCopied };
