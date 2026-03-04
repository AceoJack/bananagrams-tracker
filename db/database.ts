import { Platform } from "react-native";

type DbModule = typeof import("./database.native");

export async function initDb() {
  if (Platform.OS === "web") {
    // no-op: we don't support web in this project
    return;
  }
  const mod: DbModule = await import("./database.native");
  return mod.initDb();
}

export async function getDb() {
  if (Platform.OS === "web") {
    throw new Error("SQLite is not supported on web for this app.");
  }
  const mod: DbModule = await import("./database.native");
  return mod.getDb();
}