// db/queries.firestore.ts
import {
  collection,
  doc,
  getDoc,
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
export type Game = {
  id: string;
  playedAt: string;
  durationSeconds: number;
  playerIds: string[];
  winnerId: string;
  winnerName: string;
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

  // Gather unique winnerIds
  const winnerIds = Array.from(
    new Set(
      snap.docs
        .map((d) => (d.data() as any).winnerId as string)
        .filter(Boolean)
    )
  );

  // Fetch winners
  const winnerPairs = await Promise.all(
    winnerIds.map(async (id) => {
      const psnap = await getDoc(doc(playersCol(), id));
      const name = psnap.exists() ? ((psnap.data() as any).name as string) : "Unknown";
      return [id, name] as const;
    })
  );

  const winnerMap = new Map(winnerPairs);

  // Build games with winnerName
  return snap.docs.map((d) => {
    const data = d.data() as any;
    const playedAt =
      data.playedAt instanceof Timestamp ? data.playedAt.toDate().toISOString() : data.playedAt;

    const winnerId = data.winnerId as string;

    return {
      id: d.id,
      playedAt,
      durationSeconds: data.durationSeconds,
      playerIds: data.playerIds ?? [],
      winnerId,
      winnerName: winnerMap.get(winnerId) ?? "Unknown",
    };
  });
}

export async function createGame(input: {
  playedAtISO: string;
  durationSeconds: number;
  playerIds: string[];
  winnerId: string;
}) {
  await ensureAuthClientSide();
  const { playedAtISO, durationSeconds, playerIds, winnerId } = input;

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