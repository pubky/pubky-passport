import { toCanvas } from "qrcode";
import { DEVELOPMENT_SIGNUP_HOMESERVER, SHOW_DEVELOPMENT_SIGNUP } from "./config";
import { disabledAttr, escapeHtml } from "./html";

export interface RingSigninState {
  authorizationUrl?: string;
  copied?: boolean;
  expired?: boolean;
  loading?: boolean;
  token?: symbol;
}

const RING_QR_SIZE = 220;
const AUTHORIZE_LINK_ID = "authorize-ring";

export function authViewHtml(ringSignin: RingSigninState, busy?: string) {
  return `
    <section class="auth-grid ${SHOW_DEVELOPMENT_SIGNUP ? "" : "ring-only"}">
      ${ringPanelHtml(ringSignin, busy)}
      ${SHOW_DEVELOPMENT_SIGNUP ? newIdentityPanel(busy) : ""}
    </section>
  `;
}

export function updateRingPanel(ringSignin: RingSigninState, busy?: string) {
  const panel = document.querySelector("#ring-panel");
  if (!panel) return;
  panel.innerHTML = ringPanelBody(ringSignin, busy);
  void renderRingSigninQr(ringSignin);
}

export function updateCopyButton(copied: boolean) {
  const button = document.querySelector("#copy-authorization-url");
  if (button) button.textContent = copied ? "Copied" : "Copy link";
}

export function updateAuthorizeLink(canUse: boolean, authorizationUrl?: string) {
  const link = document.querySelector<HTMLAnchorElement>(`#${AUTHORIZE_LINK_ID}`);
  if (!link) return;

  if (canUse && authorizationUrl) {
    link.href = authorizationUrl;
    link.removeAttribute("aria-disabled");
    return;
  }

  link.removeAttribute("href");
  link.setAttribute("aria-disabled", "true");
}

export function isAuthorizeRingLink(element: Element) {
  return Boolean(element.closest(`#${AUTHORIZE_LINK_ID}`));
}

export async function renderRingSigninQr(ringSignin: RingSigninState) {
  const canvas = document.querySelector<HTMLCanvasElement>("#ring-signin-qr");
  const authorizationUrl = ringSignin.authorizationUrl;
  if (!canvas || !authorizationUrl || ringSignin.expired) return;

  try {
    await toCanvas(canvas, authorizationUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: RING_QR_SIZE,
      color: {
        dark: "#101828",
        light: "#ffffff",
      },
    });
  } catch {
    // The authorization link remains available if the QR renderer fails.
  }
}

function ringPanelHtml(ringSignin: RingSigninState, busy?: string) {
  return `<section id="ring-panel" class="panel">${ringPanelBody(ringSignin, busy)}</section>`;
}

function ringPanelBody(ringSignin: RingSigninState, busy?: string) {
  const { authorizationUrl, copied, expired, loading } = ringSignin;
  const isBusy = Boolean(busy);
  const canUseAuthorizationUrl = !isBusy && Boolean(authorizationUrl) && !loading && !expired;

  return `
    <div class="section-header">
      <h2>Sign in with Pubky Ring</h2>
      <button id="refresh-ring-signin" type="button" ${disabledAttr(isBusy || Boolean(loading))}>
        ${expired ? "New link" : "Refresh"}
      </button>
    </div>
    <div class="ring-signin">
      <div class="qr-frame">
        ${ringQrSlot(ringSignin)}
      </div>
      <div class="ring-actions">
        ${authorizeLinkHtml(canUseAuthorizationUrl, authorizationUrl)}
        <button id="copy-authorization-url" type="button" ${disabledAttr(!canUseAuthorizationUrl)}>
          ${copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  `;
}

function authorizeLinkHtml(canUse: boolean, authorizationUrl: string | undefined) {
  if (canUse && authorizationUrl) {
    return `<a id="${AUTHORIZE_LINK_ID}" class="button-link primary" href="${escapeHtml(authorizationUrl)}">Authorize with Pubky Ring</a>`;
  }

  return `<a id="${AUTHORIZE_LINK_ID}" class="button-link primary" aria-disabled="true">Authorize with Pubky Ring</a>`;
}

function ringQrSlot(ringSignin: RingSigninState) {
  const { authorizationUrl, expired, loading } = ringSignin;

  if (loading) {
    return ringQrPlaceholder(`
      <span class="spinner" aria-hidden="true"></span>
      <span>Generating link...</span>
    `);
  }

  if (expired) {
    return ringQrPlaceholder(`
      <strong>Link expired</strong>
      <span>Generate a fresh one.</span>
    `);
  }

  if (!authorizationUrl) return ringQrPlaceholder("<span>Waiting for Ring link...</span>");

  return `
    <canvas
      id="ring-signin-qr"
      class="ring-qr"
      width="${RING_QR_SIZE}"
      height="${RING_QR_SIZE}"
      aria-label="Pubky Ring sign-in QR code"
    ></canvas>
  `;
}

function ringQrPlaceholder(content: string) {
  return `<div class="qr-placeholder" aria-live="polite">${content}</div>`;
}

function newIdentityPanel(busy?: string) {
  return `
    <section class="panel">
      <h2>New identity</h2>
      <p class="muted">
        Create a new keypair, sign up and sign in on the homeserver, in one go.
        Primarily for development, to move through auth quickly.
      </p>
      <p class="muted">
        Requires the homeserver to run with signup_mode = "open". If signup is closed or
        token-required, this shortcut will fail; use Pubky Ring instead.
      </p>
      <form id="development-signup-form" class="form-grid">
        <label>
          Homeserver public key
          <input
            name="homeserver"
            autocomplete="off"
            value="${escapeHtml(DEVELOPMENT_SIGNUP_HOMESERVER)}"
            required
          />
        </label>
        <button type="submit" ${disabledAttr(Boolean(busy))}>Create identity and sign in</button>
      </form>
    </section>
  `;
}
