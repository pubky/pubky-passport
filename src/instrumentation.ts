export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getPublicEnvironment, getServerEnvironment } = await import("./server/environment");
  const { instance } = getPublicEnvironment();
  // The keyring backs only Google recovery, so an instance without Google never reads it.
  if (instance.features.google) getServerEnvironment();
}
