import { defineConfig } from "vite";

// An inline PostCSS config stops Vite from loading Passport's Tailwind config,
// which is incompatible with this demo's build.
export default defineConfig({ css: { postcss: { plugins: [] } } });
