import type { Session } from "@synonymdev/pubky";
import { h } from "./dom";
import { deleteFile, FILES_DIR, listFiles, saveFile, type AppFile } from "./storage";

/** The signed-in page's files panel: what the Session can do on the person's homeserver. */
export async function renderFiles(container: HTMLElement, session: Session): Promise<void> {
  const status = h("p", { class: "hint", role: "status" }, "Loading files…");
  const list = h("ul", { class: "file-list" });
  const title = h("input", { name: "title", placeholder: "Title", autocomplete: "off" });
  const body = h("textarea", { name: "body", rows: "3", placeholder: "Body" });
  const form = h(
    "form",
    { class: "form-grid" },
    title,
    body,
    h("button", { type: "submit" }, "Create file"),
  );
  container.replaceChildren(h("h3", {}, `Your files (${FILES_DIR})`), form, status, list);
  const refresh = async () => {
    try {
      show(await listFiles(session));
      status.textContent = "";
    } catch (error) {
      status.textContent = `Could not list files: ${message(error)}`;
    }
  };
  const show = (files: AppFile[]) => {
    list.replaceChildren(
      ...files.map((file) => {
        const remove = h("button", { type: "button" }, "Delete");
        remove.addEventListener("click", async () => {
          status.textContent = "Deleting…";
          await deleteFile(session, file.id).catch((error: unknown) => {
            status.textContent = `Could not delete: ${message(error)}`;
          });
          await refresh();
        });
        return h("li", {}, h("strong", {}, file.title), h("span", {}, file.body), remove);
      }),
    );
    if (!files.length) list.append(h("li", { class: "hint" }, "No files yet."));
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Saving…";
    try {
      await saveFile(session, { title: title.value, body: body.value });
      title.value = "";
      body.value = "";
      await refresh();
    } catch (error) {
      status.textContent = `Could not save: ${message(error)}`;
    }
  });
  await refresh();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
