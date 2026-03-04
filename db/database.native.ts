import * as SQLite from "expo-sqlite";
import { SCHEMA_SQL } from "./schema";

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb() {
  if (!db) {
    db = await SQLite.openDatabaseAsync("bananagrams.db");
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
  return db;
}

export async function initDb() {
  const database = await getDb();
  await database.execAsync(SCHEMA_SQL);
}