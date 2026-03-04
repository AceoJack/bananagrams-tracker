export async function getDb(): Promise<never> {
  throw new Error("SQLite is not supported on web for this app.");
}

export async function initDb() {
  // No-op so the app can bundle for web without crashing Metro
}