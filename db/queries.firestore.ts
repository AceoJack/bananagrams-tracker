// db/queries.firestore.ts
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { getFirebaseAuth, getFirebaseDb } from "../utils/firebase";

export type Player = { id: string; name: string; wins: number; losses: number };

export type StoredBoardTile = { letter: string; col: number; row: number };
export type StoredBoardWord = {
  word: string;
  direction: "horizontal" | "vertical";
  startCol: number;
  startRow: number;
};
export type StoredBoard = { tiles: StoredBoardTile[]; words: StoredBoardWord[] };

export type Game = {
  id: string;
  playedAt: string;
  durationSeconds: number;
  playerIds: string[];
  playerNames: string[];
  winnerId: string;
  winnerName: string;
  board?: StoredBoard;
};

async function ensureAuthClientSide() {
  // This function must only be called on the client.
  const auth = getFirebaseAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

function playersCol() {
  const db = getFirebaseDb();
  return collection(db, "players");
}

function gamesCol() {
  const db = getFirebaseDb();
  return collection(db, "games");
}

export async function listPlayers(): Promise<Player[]> {
  await ensureAuthClientSide();
  const snap = await getDocs(playersCol());
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));
}

export async function createPlayer(nameRaw: string): Promise<Player> {
  await ensureAuthClientSide();
  const name = nameRaw.trim();
  if (!name) throw new Error("Name cannot be empty.");

  const id = crypto.randomUUID();
  await setDoc(doc(playersCol(), id), {
    name,
    wins: 0,
    losses: 0,
    createdAt: serverTimestamp(),
  });

  return { id, name, wins: 0, losses: 0 };
}

export async function listGames(): Promise<Game[]> {
  await ensureAuthClientSide();

  const qy = query(gamesCol(), orderBy("playedAt", "desc"));
  const snap = await getDocs(qy);

  // Fetch all players in a single collection read (same permission path as listPlayers)
  const playerSnap = await getDocs(playersCol());
  const playerMap = new Map(
    playerSnap.docs.map((d) => [d.id, (d.data() as any).name as string])
  );

  // Build games with playerNames + winnerName
  return snap.docs.map((d) => {
    const data = d.data() as any;
    const playedAt =
      data.playedAt instanceof Timestamp ? data.playedAt.toDate().toISOString() : data.playedAt;

    const playerIds: string[] = data.playerIds ?? [];
    const winnerId = data.winnerId as string;

    return {
      id: d.id,
      playedAt,
      durationSeconds: data.durationSeconds,
      playerIds,
      playerNames: playerIds.map((id) => playerMap.get(id) ?? "Unknown"),
      winnerId,
      winnerName: playerMap.get(winnerId) ?? "Unknown",
      board: data.board ?? undefined,
    };
  });
}

export async function createGame(input: {
  playedAtISO: string;
  durationSeconds: number;
  playerIds: string[];
  winnerId: string;
  board?: StoredBoard;
}) {
  await ensureAuthClientSide();
  const { playedAtISO, durationSeconds, playerIds, winnerId, board } = input;

  if (!playerIds.length) throw new Error("Select at least 1 player.");
  if (!playerIds.includes(winnerId)) throw new Error("Winner must be in selected players.");

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const db = getFirebaseDb();

  await runTransaction(db, async (tx) => {
    // 1) READS FIRST
    const playerRefs = playerIds.map((pid) => doc(playersCol(), pid));
    const playerSnaps = await Promise.all(playerRefs.map((ref) => tx.get(ref)));

    // Map id -> data (only for existing players)
    const playerDataById = new Map<string, any>();
    for (let i = 0; i < playerIds.length; i++) {
      const snap = playerSnaps[i];
      if (snap.exists()) playerDataById.set(playerIds[i], snap.data());
    }

    // 2) WRITES AFTER ALL READS
    tx.set(doc(gamesCol(), id), {
      playedAt: Timestamp.fromDate(new Date(playedAtISO)),
      durationSeconds,
      playerIds,
      winnerId,
      ...(board ? { board } : {}),
      createdAt: serverTimestamp(),
    });

    for (const pid of playerIds) {
      const p = playerDataById.get(pid);
      if (!p) continue;

      const pref = doc(playersCol(), pid);

      if (pid === winnerId) {
        tx.update(pref, { wins: (p.wins ?? 0) + 1 });
      } else {
        tx.update(pref, { losses: (p.losses ?? 0) + 1 });
      }
    }
  });
}

export async function deleteGame(game: Game) {
  await ensureAuthClientSide();
  const db = getFirebaseDb();

  await runTransaction(db, async (tx) => {
    // Read all player docs first
    const playerRefs = game.playerIds.map((pid) => doc(playersCol(), pid));
    const playerSnaps = await Promise.all(playerRefs.map((ref) => tx.get(ref)));

    // Delete the game doc
    tx.delete(doc(gamesCol(), game.id));

    // Reverse win/loss counts
    for (let i = 0; i < game.playerIds.length; i++) {
      const pid = game.playerIds[i];
      const snap = playerSnaps[i];
      if (!snap.exists()) continue;
      const p = snap.data() as any;
      const pref = doc(playersCol(), pid);
      if (pid === game.winnerId) {
        tx.update(pref, { wins: Math.max(0, (p.wins ?? 0) - 1) });
      } else {
        tx.update(pref, { losses: Math.max(0, (p.losses ?? 0) - 1) });
      }
    }
  });
}