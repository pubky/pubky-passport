export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getApplicationEnvironment } = await import("./server/config/applicationEnvironment");
  getApplicationEnvironment();
}
