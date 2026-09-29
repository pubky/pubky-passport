import { APP_PATH } from "./config";
import type { AppEvent } from "./events";
import { disabledAttr, escapeHtml } from "./html";

export function eventStreamPanelHtml(events: AppEvent[], streaming: boolean, busy?: string) {
  return `
    <section class="panel event-stream-panel">
      <div class="section-header">
        <div>
          <h2>Event stream</h2>
          <p class="muted">Path filter: ${escapeHtml(APP_PATH)}</p>
        </div>
        <button id="toggle-event-stream" type="button" ${disabledAttr(Boolean(busy))}>
          ${streaming ? "Stop" : "Start"}
        </button>
      </div>
      <div id="event-list">${eventListHtml(events)}</div>
    </section>
  `;
}

export function updateEventList(events: AppEvent[]) {
  const list = document.querySelector("#event-list");
  if (!list) return;
  list.innerHTML = eventListHtml(events);
}

export function updateEventStreamToggle(streaming: boolean) {
  const button = document.querySelector("#toggle-event-stream");
  if (button) button.textContent = streaming ? "Stop" : "Start";
}

function eventListHtml(events: AppEvent[]) {
  if (events.length === 0) {
    return '<p class="empty">No events yet.</p>';
  }

  return `
    <ol class="event-list">
      ${events.map(eventStreamEventItem).join("")}
    </ol>
  `;
}

function eventStreamEventItem(event: AppEvent) {
  return `
    <li>
      <strong>${escapeHtml(event.type)}</strong>
      <span>${escapeHtml(event.path)}</span>
      ${event.contentHash ? `<small>Content hash: ${escapeHtml(event.contentHash)}</small>` : ""}
      <small>Cursor: ${escapeHtml(event.cursor)}</small>
    </li>
  `;
}
