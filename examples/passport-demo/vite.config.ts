import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Files the page links to as plain text: the guide, the package README and the integration. */
const TEXT_FILES = {
  "/integration.md": resolve(import.meta.dirname, "../../docs/integration.md"),
  "/package-readme.md": resolve(import.meta.dirname, "../../packages/passport-client/README.md"),
  "/source/passport.ts": resolve(import.meta.dirname, "src/passport.ts"),
};

/** Serves TEXT_FILES as text/plain on the dev server and copies them into the build. */
function textFiles(): Plugin {
  return {
    name: "text-files",
    configureServer(server) {
      for (const [path, file] of Object.entries(TEXT_FILES))
        server.middlewares.use(path, (_request, response) => {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(readFileSync(file, "utf8"));
        });
    },
    generateBundle() {
      for (const [path, file] of Object.entries(TEXT_FILES))
        this.emitFile({
          type: "asset",
          fileName: path.slice(1),
          source: readFileSync(file, "utf8"),
        });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "DEMO_"]);
  const hmrPort = Number(env.VITE_HMR_CLIENT_PORT) || undefined;
  // Behind a port forward, its host names (comma-separated, ".example.com" for subdomains).
  const allowedHosts = env.DEMO_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    // An inline PostCSS config stops Vite from loading Passport's Tailwind config.
    css: { postcss: { plugins: [] } },
    plugins: [textFiles()],
    // One SDK (and one WASM instance) for the app and the Passport client.
    resolve: { dedupe: ["@synonymdev/pubky"] },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      ...(allowedHosts?.length ? { allowedHosts } : {}),
      ...(hmrPort ? { hmr: { clientPort: hmrPort } } : {}),
    },
  };
});
