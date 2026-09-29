import { disabledAttr, escapeHtml, formatDate } from "./html";
import type { AppFile } from "./storage";

export function editorPanelHtml(files: AppFile[], editingId: string | undefined, busy?: string) {
  return `
    <section class="panel">
      <div class="section-header">
        <h2>Editor</h2>
        <span id="new-file-slot">${newFileButtonHtml(editingId, busy)}</span>
      </div>
      <div id="editor">${fileFormHtml(files, editingId, busy)}</div>
    </section>
  `;
}

export function filesPanelHtml(files: AppFile[], busy?: string) {
  return `
    <section class="panel">
      <h2>Files</h2>
      <div id="files-list">${filesListHtml(files, busy)}</div>
    </section>
  `;
}

export function updateEditor(files: AppFile[], editingId: string | undefined, busy?: string) {
  const editor = document.querySelector("#editor");
  if (editor) editor.innerHTML = fileFormHtml(files, editingId, busy);

  const slot = document.querySelector("#new-file-slot");
  if (slot) slot.innerHTML = newFileButtonHtml(editingId, busy);
}

export function updateFilesList(files: AppFile[], busy?: string) {
  const list = document.querySelector("#files-list");
  if (!list) return;
  list.innerHTML = filesListHtml(files, busy);
}

function newFileButtonHtml(editingId: string | undefined, busy?: string) {
  if (!editingId) return "";
  return `<button id="new-file" type="button" ${disabledAttr(Boolean(busy))}>New</button>`;
}

function fileFormHtml(files: AppFile[], editingId: string | undefined, busy?: string) {
  const file = files.find((item) => item.id === editingId);

  return `
    <form id="file-form" class="form-grid">
      <label>
        Title
        <input name="title" value="${escapeHtml(file?.title || "")}" autocomplete="off" />
      </label>
      <label>
        Body
        <textarea name="body" rows="8">${escapeHtml(file?.body || "")}</textarea>
      </label>
      <button type="submit" ${disabledAttr(Boolean(busy))}>${file ? "Update" : "Create"}</button>
    </form>
  `;
}

function filesListHtml(files: AppFile[], busy?: string) {
  if (files.length === 0) {
    return '<p class="empty">No files yet.</p>';
  }

  return `
    <ul class="file-list">
      ${files.map((file) => fileItem(file, busy)).join("")}
    </ul>
  `;
}

function fileItem(file: AppFile, busy?: string) {
  return `
    <li>
      <div>
        <strong>${escapeHtml(file.title)}</strong>
        <span>${escapeHtml(formatDate(file.updatedAt))}</span>
      </div>
      <div class="actions">
        <button type="button" data-edit-id="${escapeHtml(file.id)}" ${disabledAttr(Boolean(busy))}>Edit</button>
        <button type="button" data-delete-id="${escapeHtml(file.id)}" ${disabledAttr(Boolean(busy))}>Delete</button>
      </div>
    </li>
  `;
}
