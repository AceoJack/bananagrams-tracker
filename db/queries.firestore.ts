// db/queries.firestore.ts
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth, getFirebaseDb } from "../utils/firebase";

// Cached promise that resolves once Firebase has loaded the persisted auth state.
// Without this, auth.currentUser is null on startup even if a session exists.
let _authReadyPromise: Promise<void> | null = null;
function waitForAuthReady(): Promise<void> {
  if (_authReadyPromise) return _authReadyPromise;
  _authReadyPromise = new Promise<void>((resolve) => {
    const auth = getFirebaseAuth();
    // onAuthStateChanged fires immediately with the current state once Firebase
    // has finished loading the persisted session (or null if there is none).
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
  return _authReadyPromise;
}

export type UserProfile = {
  uid: string;
  displayName: string;
  displayNameLower: string;
  email: string | null;
  photoURL: string | null;
  linkedPlayerId: string | null;
  wins: number;
  losses: number;
};

export type FriendProfile = {
  uid: string;
  displayName: string;
  photoURL: string | null;
  linkedPlayerId: string | null;
  addedAt: number; // ms epoch
};

// ── Guests (user-owned named slots) ───────────────────────────────────────────

export type Guest = {
  id: string;
  name: string;
  ownerUid: string;
  wins: number;
  losses: number;
};

// ── PlayerSlot (unified player representation for games and sessions) ──────────

export type PlayerSlot = {
  type: "user" | "guest";
  uid: string;                    // Firebase uid for users; guest doc id for guests
  ownerUid: string | null;        // null for users; ownerUid for guests
  ownerDisplayName: string | null; // shown as tag next to guest name
  displayName: string;
  status: "active" | "eliminated" | "winner";
};

// ── Game session (room mode) ───────────────────────────────────────────────────

export type SessionStatus = "lobby" | "active" | "ended";

export type GameSession = {
  id: string;
  hostUid: string;
  joinCode: string;
  status: SessionStatus;
  players: PlayerSlot[];
  timer: { startedAt: string | null; elapsed: number };
  eliminations: Elimination[];
  winnerId: string | null;
  outcome: "bananas" | "last_standing" | null;
  createdAt: string;
};

export type Player = { id: string; name: string; wins: number; losses: number; linkedUid?: string };

export type StoredBoardTile = { letter: string; col: number; row: number };
export type StoredBoardWord = {
  word: string;
  direction: "horizontal" | "vertical";
  startCol: number;
  startRow: number;
};
export type StoredBoard = { tiles: StoredBoardTile[]; words: StoredBoardWord[] };

export type Elimination = {
  playerId: string;
  eliminatedAt: number; // elapsed ms at elimination
  reason: "rotten";
};

export type Game = {
  id: string;
  playedAt: string;
  durationSeconds: number;
  playerIds: string[];
  playerNames: string[];
  winnerId: string;
  winnerName: string;
  board?: StoredBoard;
  boards?: Record<string, StoredBoard>; // all uploaded boards keyed by player uid
  eliminations?: Elimination[];
  outcome?: "bananas" | "last_standing";
};

async function ensureAuthClientSide() {
  // Wait for Firebase to finish loading the persisted session.
  // The auth gate in _layout.tsx ensures a Google user is always signed in
  // before any query runs, so currentUser will be set by the time this resolves.
  await waitForAuthReady();
}

function playersCol() {
  const db = getFirebaseDb();
  return collection(db, "players");
}

function gamesCol() {
  const db = getFirebaseDb();
  return collection(db, "games");
}

function usersCol() {
  const db = getFirebaseDb();
  return collection(db, "users");
}

function guestsCol(uid: string) {
  const db = getFirebaseDb();
  return collection(db, "users", uid, "guests");
}

function sessionsCol() {
  const db = getFirebaseDb();
  return collection(db, "gameSessions");
}

// ── User profiles ──────────────────────────────────────────────────────────────

export async function getOrCreateUserProfile(user: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): Promise<UserProfile> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();
  const ref = doc(usersCol(), user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return { uid: user.uid, ...(snap.data() as any) } as UserProfile;
  }

  const displayName = user.displayName ?? user.email?.split("@")[0] ?? "Anonymous";
  const profile: Omit<UserProfile, "uid"> = {
    displayName,
    displayNameLower: displayName.toLowerCase(),
    email: user.email,
    photoURL: user.photoURL,
    linkedPlayerId: null,
    wins: 0,
    losses: 0,
  };
  await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  return { uid: user.uid, ...profile };
}

export async function updateUserProfile(
  uid: string,
  fields: Partial<Pick<UserProfile, "displayName">>
): Promise<void> {
  await ensureAuthClientSide();
  const ref = doc(usersCol(), uid);
  const update: any = { ...fields };
  if (fields.displayName) update.displayNameLower = fields.displayName.toLowerCase();
  await updateDoc(ref, update);
}

// ── Friends ────────────────────────────────────────────────────────────────────

function friendsCol(uid: string) {
  const db = getFirebaseDb();
  return collection(db, "users", uid, "friends");
}

/**
 * Search users by display name prefix (case-insensitive).
 * Excludes the current user. Returns up to 10 results.
 */
export async function searchUsers(term: string, currentUid: string): Promise<UserProfile[]> {
  await ensureAuthClientSide();
  const lower = term.trim().toLowerCase();
  if (!lower) return [];

  const qy = query(
    usersCol(),
    where("displayNameLower", ">=", lower),
    where("displayNameLower", "<=", lower + "\uf8ff"),
    limit(10)
  );
  const snap = await getDocs(qy);
  return snap.docs
    .filter((d) => d.id !== currentUid)
    .map((d) => ({ uid: d.id, ...(d.data() as any) } as UserProfile));
}

export async function getFriends(uid: string): Promise<FriendProfile[]> {
  await ensureAuthClientSide();
  const snap = await getDocs(query(friendsCol(uid), orderBy("addedAt", "asc")));
  return snap.docs.map((d) => d.data() as FriendProfile);
}

export async function addFriend(uid: string, friend: UserProfile): Promise<void> {
  await ensureAuthClientSide();
  const ref = doc(friendsCol(uid), friend.uid);
  const data: FriendProfile = {
    uid: friend.uid,
    displayName: friend.displayName,
    photoURL: friend.photoURL,
    linkedPlayerId: friend.linkedPlayerId,
    addedAt: Date.now(),
  };
  await setDoc(ref, data);
}

export async function removeFriend(uid: string, friendUid: string): Promise<void> {
  await ensureAuthClientSide();
  await deleteDoc(doc(friendsCol(uid), friendUid));
}

/**
 * Links a player to a user account (bidirectional).
 * Clears any previous link on either side atomically.
 */
export async function linkPlayerToUser(uid: string, playerId: string): Promise<void> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();

  const userRef = doc(usersCol(), uid);
  const playerRef = doc(playersCol(), playerId);

  const [userSnap, playerSnap] = await Promise.all([getDoc(userRef), getDoc(playerRef)]);
  if (!userSnap.exists()) throw new Error("User profile not found.");
  if (!playerSnap.exists()) throw new Error("Player not found.");

  const batch = writeBatch(db);

  // Clear the old linked player (if any) on the user side
  const prevLinkedPlayerId = (userSnap.data() as any).linkedPlayerId as string | null;
  if (prevLinkedPlayerId && prevLinkedPlayerId !== playerId) {
    batch.update(doc(playersCol(), prevLinkedPlayerId), { linkedUid: null });
  }

  // Clear the old linked user (if any) on the player side
  const prevLinkedUid = (playerSnap.data() as any).linkedUid as string | null;
  if (prevLinkedUid && prevLinkedUid !== uid) {
    batch.update(doc(usersCol(), prevLinkedUid), { linkedPlayerId: null });
  }

  batch.update(userRef, { linkedPlayerId: playerId });
  batch.update(playerRef, { linkedUid: uid });

  await batch.commit();
}

/**
 * Removes the bidirectional link between a user and their linked player.
 */
export async function unlinkPlayerFromUser(uid: string): Promise<void> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();

  const userRef = doc(usersCol(), uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const linkedPlayerId = (userSnap.data() as any).linkedPlayerId as string | null;
  if (!linkedPlayerId) return;

  const batch = writeBatch(db);
  batch.update(userRef, { linkedPlayerId: null });
  batch.update(doc(playersCol(), linkedPlayerId), { linkedUid: null });
  await batch.commit();
}

// ── Guest CRUD ─────────────────────────────────────────────────────────────────

export async function listGuests(uid: string): Promise<Guest[]> {
  await ensureAuthClientSide();
  const snap = await getDocs(guestsCol(uid));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) } as Guest))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createGuest(uid: string, name: string): Promise<Guest> {
  await ensureAuthClientSide();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name cannot be empty.");
  const id = crypto.randomUUID();
  await setDoc(doc(guestsCol(uid), id), {
    name: trimmed,
    ownerUid: uid,
    wins: 0,
    losses: 0,
    createdAt: serverTimestamp(),
  });
  return { id, name: trimmed, ownerUid: uid, wins: 0, losses: 0 };
}

export async function deleteGuest(uid: string, guestId: string): Promise<void> {
  await ensureAuthClientSide();
  await deleteDoc(doc(guestsCol(uid), guestId));
}

// ── Game session (room mode) ───────────────────────────────────────────────────

function generateJoinCode(): string {
  // Unambiguous uppercase alphanumeric (no 0/O, 1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function snapToSession(snap: any): GameSession {
  const d = snap.data();
  return {
    id: snap.id,
    hostUid: d.hostUid,
    joinCode: d.joinCode,
    status: d.status,
    players: d.players ?? [],
    timer: { startedAt: d.timer?.startedAt ?? null, elapsed: d.timer?.elapsed ?? 0 },
    eliminations: d.eliminations ?? [],
    winnerId: d.winnerId ?? null,
    outcome: d.outcome ?? null,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : (d.createdAt ?? ""),
  };
}

export async function createGameSession(host: UserProfile): Promise<GameSession> {
  await ensureAuthClientSide();
  const id = crypto.randomUUID();
  const joinCode = generateJoinCode();
  const hostSlot: PlayerSlot = {
    type: "user",
    uid: host.uid,
    ownerUid: null,
    ownerDisplayName: null,
    displayName: host.displayName,
    status: "active",
  };
  await setDoc(doc(sessionsCol(), id), {
    hostUid: host.uid,
    joinCode,
    status: "lobby",
    players: [hostSlot],
    timer: { startedAt: null, elapsed: 0 },
    eliminations: [],
    winnerId: null,
    outcome: null,
    createdAt: serverTimestamp(),
  });
  return {
    id,
    hostUid: host.uid,
    joinCode,
    status: "lobby",
    players: [hostSlot],
    timer: { startedAt: null, elapsed: 0 },
    eliminations: [],
    winnerId: null,
    outcome: null,
    createdAt: new Date().toISOString(),
  };
}

export async function getSessionByCode(code: string): Promise<GameSession | null> {
  await ensureAuthClientSide();
  const upper = code.trim().toUpperCase();
  const q = query(
    sessionsCol(),
    where("joinCode", "==", upper),
    where("status", "==", "lobby"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snapToSession(snap.docs[0]);
}

/** Add an authenticated user's slot to a lobby session (join by code flow). */
export async function joinGameSession(sessionId: string, slot: PlayerSlot): Promise<void> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();
  await runTransaction(db, async (tx) => {
    const ref = doc(sessionsCol(), sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found.");
    const players: PlayerSlot[] = (snap.data() as any).players ?? [];
    if (players.some((p) => p.uid === slot.uid)) return; // already in
    tx.update(ref, { players: [...players, slot] });
  });
}

/** Add any slot (guest or user) from within the lobby. */
export async function addSlotToSession(sessionId: string, slot: PlayerSlot): Promise<void> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();
  await runTransaction(db, async (tx) => {
    const ref = doc(sessionsCol(), sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session not found.");
    const players: PlayerSlot[] = (snap.data() as any).players ?? [];
    if (players.some((p) => p.uid === slot.uid))
      throw new Error("This player is already in the game.");
    tx.update(ref, { players: [...players, slot] });
  });
}

/** Remove a slot by uid (host action). */
export async function removeSlotFromSession(sessionId: string, slotUid: string): Promise<void> {
  await ensureAuthClientSide();
  const db = getFirebaseDb();
  await runTransaction(db, async (tx) => {
    const ref = doc(sessionsCol(), sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const players: PlayerSlot[] = (snap.data() as any).players ?? [];
    tx.update(ref, { players: players.filter((p) => p.uid !== slotUid) });
  });
}

export async function startSession(sessionId: string): Promise<void> {
  await ensureAuthClientSide();
  await updateDoc(doc(sessionsCol(), sessionId), {
    status: "active",
    "timer.startedAt": new Date().toISOString(),
  });
}

export async function endSession(
  sessionId: string,
  winnerId: string,
  outcome: "bananas" | "last_standing",
  elapsed: number,
  eliminations: Elimination[]
): Promise<void> {
  await ensureAuthClientSide();
  await updateDoc(doc(sessionsCol(), sessionId), {
    status: "ended",
    winnerId,
    outcome,
    "timer.elapsed": elapsed,
    eliminations,
  });
}

export function subscribeToSession(
  sessionId: string,
  cb: (session: GameSession | null) => void
): () => void {
  const db = getFirebaseDb();
  return onSnapshot(doc(sessionsCol(), sessionId), (snap) => {
    cb(snap.exists() ? snapToSession(snap) : null);
  });
}

// ── Legacy player list (read-only — for historical data only) ─────────────────

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

    // New games embed names directly; legacy games look up from playerMap
    const playerNames: string[] =
      data.playerNames ?? playerIds.map((id: string) => playerMap.get(id) ?? "Unknown");
    const winnerName: string =
      data.winnerName ?? playerMap.get(winnerId) ?? "Unknown";

    return {
      id: d.id,
      playedAt,
      durationSeconds: data.durationSeconds,
      playerIds,
      playerNames,
      winnerId,
      winnerName,
      board: data.board ?? undefined,
      eliminations: data.eliminations ?? undefined,
      outcome: data.outcome ?? undefined,
    };
  });
}

export async function createGame(input: {
  playedAtISO: string;
  durationSeconds: number;
  playerIds: string[];
  winnerId: string;
  board?: StoredBoard;
  eliminations?: Elimination[];
  outcome?: "bananas" | "last_standing";
}) {
  await ensureAuthClientSide();
  const { playedAtISO, durationSeconds, playerIds, winnerId, board, eliminations, outcome } = input;

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
      ...(eliminations?.length ? { eliminations } : {}),
      ...(outcome ? { outcome } : {}),
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

/**
 * Save a game from a slot-based session (local or room).
 * Embeds player names directly — does NOT reference the legacy players collection.
 * Updates wins/losses on guest docs and user profiles.
 */
export async function addPlayerBoard(
  gameId: string,
  playerUid: string,
  board: StoredBoard
): Promise<void> {
  await ensureAuthClientSide();
  await updateDoc(doc(gamesCol(), gameId), { [`boards.${playerUid}`]: board });
}

export async function createGameFromSlots(input: {
  playedAtISO: string;
  durationSeconds: number;
  slots: PlayerSlot[];
  winnerId: string;
  board?: StoredBoard;
  eliminations?: Elimination[];
  outcome?: "bananas" | "last_standing";
}): Promise<string> {
  await ensureAuthClientSide();
  const { playedAtISO, durationSeconds, slots, winnerId, board, eliminations, outcome } = input;

  if (!slots.length) throw new Error("No players in game.");
  const winner = slots.find((s) => s.uid === winnerId);
  if (!winner) throw new Error("Winner must be a player in this game.");

  const db = getFirebaseDb();
  const id = crypto.randomUUID();

  // Write the game record with embedded names
  await setDoc(doc(gamesCol(), id), {
    playedAt: Timestamp.fromDate(new Date(playedAtISO)),
    durationSeconds,
    playerIds: slots.map((s) => s.uid),
    playerNames: slots.map((s) => s.displayName),
    winnerId,
    winnerName: winner.displayName,
    slots, // stored so deleteGame can reverse stats
    ...(board ? { board, boards: { [winnerId]: board } } : {}),
    ...(eliminations?.length ? { eliminations } : {}),
    ...(outcome ? { outcome } : {}),
    createdAt: serverTimestamp(),
  });

  // Update stats with a batch (reads must happen before batch commits)
  const batch = writeBatch(db);
  for (const slot of slots) {
    const isWinner = slot.uid === winnerId;
    if (slot.type === "guest" && slot.ownerUid) {
      const ref = doc(guestsCol(slot.ownerUid), slot.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data() as any;
        batch.update(ref, isWinner ? { wins: (d.wins ?? 0) + 1 } : { losses: (d.losses ?? 0) + 1 });
      }
    } else if (slot.type === "user") {
      const ref = doc(usersCol(), slot.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data() as any;
        batch.update(ref, isWinner ? { wins: (d.wins ?? 0) + 1 } : { losses: (d.losses ?? 0) + 1 });
      }
    }
  }
  await batch.commit();
  return id;
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