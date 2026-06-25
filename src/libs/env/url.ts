import { z } from "zod";

export type EnvLike = Record<string, string | undefined>;

const localhostHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isDevelopmentEnv(input: EnvLike): boolean {
  return input.NODE_ENV === "development";
}

export function envUrlSchema(name: string, options: { allowLocalhostHttp: boolean }) {
  return z
    .string()
    .trim()
    .min(1, `${name} is required`)
    .superRefine((value, context) => {
      let url: URL;

      try {
        url = new URL(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: `${name} must be a valid URL`,
        });
        return;
      }

      if (url.protocol === "https:") {
        return;
      }

      if (
        options.allowLocalhostHttp &&
        url.protocol === "http:" &&
        localhostHosts.has(url.hostname)
      ) {
        return;
      }

      context.addIssue({
        code: "custom",
        message: `${name} must use https, except localhost http in development`,
      });
    });
}

export const requiredStringSchema = (name: string) =>
  z.string().trim().min(1, `${name} is required`);
