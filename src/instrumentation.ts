export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateApplicationEnvironment } = await import("./server/config/applicationEnvironment");
  validateApplicationEnvironment();
}
