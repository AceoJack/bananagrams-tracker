import { getDb } from "./database";
import { v4 as uuidv4 } from "uuid";

export type PlayerRow = {
  id: string;
  name: string;
  wins: number;
  losses: number;
};

export type GameRow = {
  id: string;
  played_at: string;
  duration_seconds: number;
  winnerName: string;
};

export async function listPlayers(): Promise<PlayerRow[]> {
  const db = await getDb();
  return await db.getAllAsync<PlayerRow>(
    `SELECT id, name, wins, losses
     FROM players
     ORDER BY wins DESC, name ASC;`
  );
}

export async function createPlayer(nameRaw: string): Promise<PlayerRow> {
  const name = nameRaw.trim();
  if (!name) throw new Error("Name cannot be empty.");

  const db = await getDb();
  const id = uuidv4();

  try {
    await db.runAsync(
      `INSERT INTO players (id, name, wins, losses) VALUES (?, ?, 0, 0);`,
      [id, name]
    );
  } catch (e: any) {
    // Likely UNIQUE constraint fail
    if (String(e?.message || "").toLowerCase().includes("unique")) {
      throw new Error("That player name already exists.");
    }
    throw e;
  }

  const rows = await db.getAllAsync<PlayerRow>(
    `SELECT id, name, wins, losses FROM players WHERE id = ?;`,
    [id]
  );
  return rows[0];
}

export async function listGames(): Promise<GameRow[]> {
  const db = await getDb();
  return await db.getAllAsync<GameRow>(
    `SELECT g.id, g.played_at, g.duration_seconds, p.name as winnerName
     FROM games g
     JOIN players p ON p.id = g.winner_player_id
     ORDER BY g.played_at DESC;`
  );
}

export type CreateGameInput = {
  playedAtISO: string;
  durationSeconds: number;
  playerIds: string[];
  winnerId: string;
};

export async function createGame(input: CreateGameInput): Promise<void> {
  const { playedAtISO, durationSeconds, playerIds, winnerId } = input;

  if (playerIds.length < 1) throw new Error("Select at least 1 player.");
  if (!playerIds.includes(winnerId)) throw new Error("Winner must be in selected players.");
  if (durationSeconds < 0) throw new Error("Invalid duration.");

  const db = await getDb();
  const gameId = uuidv4();

  await db.execAsync("BEGIN;");

  try {
    // 1) Insert game
    await db.runAsync(
      `INSERT INTO games (id, played_at, duration_seconds, winner_player_id)
       VALUES (?, ?, ?, ?);`,
      [gameId, playedAtISO, durationSeconds, winnerId]
    );

    // 2) Insert join rows
    for (const pid of playerIds) {
      await db.runAsync(
        `INSERT INTO game_players (game_id, player_id) VALUES (?, ?);`,
        [gameId, pid]
      );
    }

    // 3) Update stats
    await db.runAsync(
      `UPDATE players SET wins = wins + 1 WHERE id = ?;`,
      [winnerId]
    );

    const loserIds = playerIds.filter((id) => id !== winnerId);
    for (const lid of loserIds) {
      await db.runAsync(
        `UPDATE players SET losses = losses + 1 WHERE id = ?;`,
        [lid]
      );
    }

    await db.execAsync("COMMIT;");
  } catch (e) {
    await db.execAsync("ROLLBACK;");
    throw e;
  }
}