export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getPublicEnvironment, getServerEnvironment } = await import("./server/environment");
  getPublicEnvironment();
  getServerEnvironment();
}
