const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

export function disabledAttr(disabled: boolean) {
  return disabled ? "disabled" : "";
}

export function formValue(formData: FormData, name: string) {
  return String(formData.get(name) || "");
}

export function formatDate(value: string) {
  if (!value) return "";
  return dateFormatter.format(new Date(value));
}

export function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function statusMessage(message: string, path: string | undefined) {
  const escapedMessage = escapeHtml(message);
  if (!path) return escapedMessage;
  return `${escapedMessage} <em>${escapeHtml(path)}</em>`;
}

export async function copyTextToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    textArea.remove();
  }
}
