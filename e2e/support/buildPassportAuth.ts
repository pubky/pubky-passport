import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import type { FullConfig } from "@playwright/test";

/** Builds packages/passport-auth so e2e/passport-auth.spec.ts serves the real dist files. */
export default function buildPassportAuth(config: FullConfig): void {
  const root = config.configFile ? dirname(config.configFile) : process.cwd();
  const packageDir = join(root, "packages", "passport-auth");
  rmSync(join(packageDir, "dist"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(packageDir, "tsconfig.build.json"),
    ],
    { stdio: "inherit" },
  );
}
