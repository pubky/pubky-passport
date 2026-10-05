export interface Clock {
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(callback, ms) {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};
