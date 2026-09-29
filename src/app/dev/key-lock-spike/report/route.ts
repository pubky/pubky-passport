import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Result } from "better-result";
import { readBoundedText } from "@/libs/http/boundedBody";
import { keyLockSpikeReportSchema, SPIKE_REPORT_MAX_BYTES } from "@/libs/keyLockSpikeReport";

export async function POST(request: Request): Promise<Response> {
  const directory = process.env.SPIKE_REPORT_DIR;
  if (process.env.NODE_ENV !== "development" || !directory) return response(404);
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin") return response(403);
  const body = await readBoundedText(request, SPIKE_REPORT_MAX_BYTES);
  if (Result.isError(body)) return response(body.error.code === "body_too_large" ? 413 : 400);
  let json: unknown;
  try {
    json = JSON.parse(body.value);
  } catch {
    return response(400);
  }
  const report = keyLockSpikeReportSchema.safeParse(json);
  if (!report.success) return response(400);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const digest = createHash("sha256").update(report.data.userAgent).digest("hex").slice(0, 8);
  try {
    await writeFile(join(directory, `${timestamp}-${digest}.json`), JSON.stringify(report.data), {
      flag: "wx",
      mode: 0o600,
    });
    return response(201);
  } catch (e) {
    return response(
      typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST" ? 409 : 500,
    );
  }
}

function response(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function unsupportedMethod(): Response {
  return response(process.env.NODE_ENV === "development" ? 405 : 404);
}
export {
  unsupportedMethod as GET,
  unsupportedMethod as HEAD,
  unsupportedMethod as OPTIONS,
  unsupportedMethod as PUT,
  unsupportedMethod as PATCH,
  unsupportedMethod as DELETE,
};
