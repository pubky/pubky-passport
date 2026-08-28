import "@testing-library/jest-dom/vitest";

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal() {
    if (this.open) throw new DOMException("The dialog is already open", "InvalidStateError");
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(returnValue = "") {
    if (!this.open) return;
    this.returnValue = returnValue;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
