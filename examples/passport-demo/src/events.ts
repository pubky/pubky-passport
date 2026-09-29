import type { Event as PubkyEvent, Session } from "@synonymdev/pubky";
import { APP_PATH } from "./config";
import { pubky } from "./pubky";
import { freeHandle } from "./freeHandle";

export interface AppEvent {
  type: string;
  path: string;
  cursor: string;
  contentHash?: string;
}

export interface AppEventStream {
  done: Promise<void>;
  stop: () => Promise<void>;
}

export async function startAppEventStream(
  session: Session,
  onEvent: (event: AppEvent) => void,
): Promise<AppEventStream> {
  const info = session.info;
  let publicKey: typeof info.publicKey | undefined;
  let eventStream: ReadableStream;
  try {
    publicKey = info.publicKey;
    // path(), live() and subscribe() each take ownership of their builder.
    eventStream = await pubky.eventStreamForUser(publicKey, null).path(APP_PATH).live().subscribe();
  } finally {
    freeHandle(publicKey);
    freeHandle(info);
  }

  const reader = eventStream.getReader();
  let stopped = false;

  async function read() {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) return;

        onEvent(toAppEvent(value as PubkyEvent));
      }
    } finally {
      stopped = true;
      try {
        await reader.cancel();
      } catch {
        // Preserve a read/consumer failure if the stream has already errored.
      } finally {
        reader.releaseLock();
      }
    }
  }

  return {
    done: read(),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await reader.cancel();
    },
  };
}

function toAppEvent(event: PubkyEvent): AppEvent {
  let resource: typeof event.resource | undefined;
  try {
    resource = event.resource;
    return {
      type: event.eventType,
      path: resource.path,
      cursor: event.cursor,
      contentHash: event.contentHash,
    };
  } finally {
    freeHandle(resource);
    freeHandle(event);
  }
}
