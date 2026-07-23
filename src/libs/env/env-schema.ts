import { z } from "zod";

export type EnvLike = Record<string, string | undefined>;

export function envUrlSchema(name: string) {
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

      if (url.protocol === "https:") return;

      context.addIssue({
        code: "custom",
        message: `${name} must use https`,
      });
    });
}

export const requiredStringSchema = (name: string) =>
  z.string().trim().min(1, `${name} is required`);
