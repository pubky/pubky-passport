import { PubkyResource } from "@synonymdev/pubky";
import type { Path, Session } from "@synonymdev/pubky";
import { APP_PATH } from "./config";
import { freeHandle } from "./freeHandle";

export interface AppFile {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

interface FileInput {
  id?: string;
  title: string;
  body: string;
}

const FILES_DIR = `${APP_PATH}files/` as Path;

export async function listFiles(session: Session) {
  const urls = await listFileUrls(session);
  const files = await Promise.all(
    urls
      .filter((url) => url.endsWith(".json"))
      .map((url) => {
        const resource = PubkyResource.parse(url);
        try {
          return readFile(session, resource.path as Path);
        } finally {
          freeHandle(resource);
        }
      }),
  );

  return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const LIST_PAGE_SIZE = 50;

async function listFileUrls(session: Session) {
  const storage = session.storage;
  try {
    const urls: string[] = [];
    let cursor: string | null = null;

    // The last listed URL is the next cursor; session.storage.list does not return a separate cursor field.
    while (true) {
      const batch = await storage.list(FILES_DIR, cursor, true, LIST_PAGE_SIZE, true);
      if (batch.length === 0) break;

      const nextCursor = batch[batch.length - 1];
      if (!nextCursor || nextCursor === cursor) break;

      urls.push(...batch);
      if (batch.length < LIST_PAGE_SIZE) break;
      cursor = nextCursor;
    }

    return urls;
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  } finally {
    freeHandle(storage);
  }
}

export async function saveFile(session: Session, input: FileInput) {
  const id = input.id || crypto.randomUUID();
  const file: AppFile = {
    id,
    title: input.title.trim() || "Untitled",
    body: input.body,
    updatedAt: new Date().toISOString(),
  };

  const storage = session.storage;
  try {
    await storage.putJson(filePath(id), file);
    return file;
  } finally {
    freeHandle(storage);
  }
}

export async function deleteFile(session: Session, id: string) {
  const storage = session.storage;
  try {
    await storage.delete(filePath(id));
  } finally {
    freeHandle(storage);
  }
}

export function filePath(id: string) {
  return `${FILES_DIR}${id}.json` as Path;
}

async function readFile(session: Session, path: Path) {
  const storage = session.storage;
  try {
    const data = await storage.getJson(path);
    return toAppFile(data, idFromPath(path));
  } finally {
    freeHandle(storage);
  }
}

function toAppFile(data: unknown, fallbackId: string): AppFile {
  const value = isRecord(data) ? data : {};

  return {
    id: String(value.id || fallbackId),
    title: String(value.title || "Untitled"),
    body: String(value.body || ""),
    updatedAt: String(value.updatedAt || ""),
  };
}

function idFromPath(path: string) {
  return (path.split("/").pop() || "").replace(/\.json$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown) {
  return isRecord(error) && isRecord(error.data) && error.data.statusCode === 404;
}
