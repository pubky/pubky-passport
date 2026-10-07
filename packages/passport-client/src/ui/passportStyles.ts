const CSS = `
:host{--p-brand:var(--passport-brand,#fff);--p-ink:var(--passport-ink,#0c0b12);--p-line:var(--passport-line,#303034);--p-fill:#333238;--p-fill-strong:#555459;--p-second:var(--passport-secondary,#303034);--p-on-second:var(--passport-on-secondary,#d4d4db);--p-danger:var(--passport-danger,#ff8a80);position:relative;display:inline-block;box-sizing:border-box;max-width:100%;min-width:0;font-family:var(--passport-font,"Inter Tight","Inter",system-ui,-apple-system,"Segoe UI",sans-serif);vertical-align:top;-webkit-font-smoothing:antialiased}
@supports (color:color-mix(in srgb,red,blue)){:host{--p-fill:color-mix(in srgb,var(--p-brand) 16%,var(--p-ink));--p-fill-strong:color-mix(in srgb,var(--p-brand) 30%,var(--p-ink))}}
:host([variant=large]){display:block}
:host([hidden]){display:none}
*,*::before,*::after{box-sizing:border-box}
.c{display:flex;flex-direction:column;gap:10px}
.large{width:100%;max-width:22rem;padding:20px;border:1px solid var(--p-line);border-radius:24px;background:var(--p-ink);color:#fff;gap:14px}
button,input{font:inherit}
.pill{display:flex;align-items:stretch;min-width:0;max-width:100%;min-height:var(--passport-height,44px);border:1px solid var(--p-brand);border-radius:999px;background:var(--p-fill);color:var(--p-brand);overflow:hidden;transition:background-color .15s}
.pill:hover{background:var(--p-fill-strong)}
.large .pill{min-height:var(--passport-height,52px)}
.main{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-width:0;padding:8px 20px;border:0;border-radius:999px;background:transparent;color:inherit;font-weight:700;font-size:15px;letter-spacing:-.01em;cursor:pointer}
.large .main{font-size:17px}
.main .row{display:flex;align-items:center;gap:10px;min-width:0;max-width:100%}
.main [data-slot=mark]{flex:none}
.main [data-slot=label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main[aria-disabled=true]{opacity:.6;cursor:default}
.main[aria-busy=true] [data-slot=mark]{animation:p-pulse 1.2s ease-in-out infinite}
@keyframes p-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.main[aria-busy=true] [data-slot=mark]{animation:none}.pill{transition:none}}
::slotted([slot=help]){flex:none;display:inline-flex;align-items:center;padding:0 10px 0 0}
.settings{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;padding:0 4px 0 0;border:0;border-left:1px solid color-mix(in srgb,var(--p-brand) 35%,transparent);background:transparent;color:inherit;cursor:pointer}
.settings[aria-expanded=true]{background:var(--p-fill-strong)}
.main:focus-visible,.settings:focus-visible{outline:2px solid var(--p-brand);outline-offset:-5px}
.settings:focus-visible{border-radius:999px}
.tray{position:absolute;top:calc(100% + 8px);left:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:min(20rem,calc(100vw - 16px));margin:0;padding:14px;border:1px solid var(--p-line);border-radius:18px;background:var(--p-ink);color:#fff;font-family:inherit;font-size:13px;line-height:1.4;text-align:left;box-shadow:0 12px 32px rgb(0 0 0/.4)}
.tray[hidden],.tray[popover]:not(:popover-open){display:none}
.tray[popover]{position:fixed;inset:auto;overflow:visible}
.tray .status{margin:0;color:#d4d4db}
.tray .status.error{color:var(--p-danger)}
.actions{display:flex;flex-wrap:nowrap;gap:8px;min-width:0}
.actions>button{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.second{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 14px;border:1px solid transparent;border-radius:999px;background:var(--p-second);color:var(--p-on-second);font-size:13px;font-weight:600;cursor:pointer}
.second:hover{background:#4a4a50}
.second:focus-visible,.picker input:focus-visible{outline:2px solid var(--p-brand);outline-offset:2px}
.ring{width:100%;min-height:44px;font-size:15px}
/* A computer cannot open the Ring app: the link shows at phone size or with a touch screen. */
@media (min-width:641px) and (pointer:fine){.ring{display:none}}
.picker{display:flex;flex-direction:column;gap:10px}
.picker label{display:flex;flex-direction:column;gap:6px;color:#d4d4db}
.picker .field{position:relative;display:flex}
.picker input{flex:1;min-width:0;min-height:44px;padding:8px 48px 8px 14px;border:1px solid #76767e;border-radius:999px;background:#ffffff0b;color:#fff}
.picker input[aria-invalid=true]{border-color:var(--p-danger)}
.accept{position:absolute;top:50%;right:6px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--p-brand);border-radius:999px;background:var(--p-fill);color:var(--p-brand);transform:translateY(-50%);cursor:pointer}
.accept:hover:not(:disabled){background:var(--p-fill-strong)}
.accept:disabled{border-color:transparent;background:transparent;color:#76767e;cursor:default}
.accept:focus-visible{outline:2px solid var(--p-brand);outline-offset:2px}
.picker .hint{min-height:1.4em;color:#89898f}
.picker .hint.error{color:var(--p-danger)}
.picker input::placeholder{color:#89898f}
.picker [role=alert]{color:var(--p-danger)}
.divider{display:flex;align-items:center;gap:10px;font-size:13px;color:#89898f}
.divider::before,.divider::after{content:"";flex:1;border-top:1px solid var(--p-line)}
.qr{position:relative;display:block;align-self:center;width:var(--passport-qr-size,232px);max-width:100%;padding:8px;border-radius:8px;background:#fff;overflow:hidden}
.qr .code{display:block;transition:opacity .15s}
.qr:active .code{opacity:.8}
.qr[data-state=expired] .code{filter:blur(3px)}
.qr .press{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer}
.qr .press:focus-visible{outline:2px solid var(--p-brand);outline-offset:-2px}
.qr .tag{position:absolute;top:50%;right:0;padding:8px 16px 8px 28px;background:var(--p-ink);color:#fff;font-size:14px;font-weight:700;white-space:nowrap;transform:translateY(-50%);clip-path:polygon(0 0,100% 0,100% 100%,16px 100%);pointer-events:none}
.caption{align-self:center;text-align:center;font-size:15px;color:#89898f}
.classic{display:flex;align-items:center;gap:8px;width:fit-content;min-height:24px;font-size:12px;line-height:16px;color:#89898f;cursor:pointer}
@media (pointer:coarse){.classic{min-height:44px}}
.classic input{appearance:none;position:relative;flex:none;width:28px;height:16px;margin:0;border:1px solid var(--p-line);border-radius:999px;background:var(--p-second);cursor:pointer}
.classic input::after{content:"";position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;background:var(--p-on-second);transition:transform .15s}
.classic input:checked{border-color:var(--p-brand)}
.classic input:checked::after{transform:translateX(12px);background:var(--p-brand)}
.classic input:focus-visible{outline:2px solid var(--p-brand);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;
const HIDDEN = ":host{display:none!important}";

function sheet(css: string): CSSStyleSheet | undefined {
  try {
    const value = new CSSStyleSheet();
    value.replaceSync(css);
    return value;
  } catch {
    return undefined;
  }
}

let cached: { base: CSSStyleSheet | undefined; hidden: CSSStyleSheet | undefined } | undefined;

/** Constructable sheets only (no <style>, no nonce); a browser without them renders unstyled. */
export function adoptPassportStyles(root: ShadowRoot, hidden: boolean): void {
  const created = (cached ??= { base: sheet(CSS), hidden: sheet(HIDDEN) });
  const sheets = [created.base, hidden ? created.hidden : undefined].filter(
    (value): value is CSSStyleSheet => value !== undefined,
  );
  try {
    root.adoptedStyleSheets = sheets;
  } catch {
    /* Unsupported: the element still works without its default styles. */
  }
}
