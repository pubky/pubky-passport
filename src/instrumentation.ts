export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAppleEnvironment, getPublicEnvironment, getServerEnvironment } =
    await import("./server/environment");
  getPublicEnvironment();
  getServerEnvironment();
  getAppleEnvironment();
}
