# Bananagrams Tracker

Expo (React Native) app for tracking Bananagrams games. Runs primarily as a **web app** — most features use web-only APIs (canvas, File input, Tesseract.js).

See `docs/DESIGN-v2.md` for the full v2 feature design (rotten banana flow, game sessions, auth).

**Active branch: `feature/signup`** — Feature 1 (rotten banana flow) complete. Feature 2 (auth + friends) ~80% complete. See status below.

---

## Stack

- **Expo** (SDK 53-ish) with Expo Router, static web output
- **Firebase** — Firestore for data, Google Auth (`utils/auth.google.ts`)
- **Tesseract.js** — OCR for reading board photos (web only)
- **canvas-confetti** — celebration animation on save
- **expo-av** — sound playback on native; `HTMLAudioElement` on web
- **react-native-gesture-handler** — swipe-to-delete on game history rows
- `baseUrl: "/bananagrams-tracker"` in app.json (affects static asset paths)

---

## Key files

| Path | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout — Google auth gate (blocks app until signed in) |
| `app/(tabs)/_layout.tsx` | Tab bar (Home, Split, Friends, Profile) — custom animated tab bar |
| `app/(tabs)/split.tsx` | Full game flow: setup → lobby → playing → checking → board_uploads → reset |
| `app/(tabs)/index.tsx` | Home screen — win/loss leaderboard for current user + their guests |
| `app/(tabs)/friends.tsx` | Friends screen — search users, add/remove friends |
| `app/(tabs)/profile.tsx` | Profile screen — avatar, edit display name, Legacy Stats link, sign out |
| `app/(tabs)/stats.tsx` | Legacy stats — game history + board stat cards (not in tab bar, reached via Profile) |
| `components/SaveGameModal.tsx` | Scan/edit wizard — modes: `save`, `check`, `upload` |
| `components/CelebrationOverlay.tsx` | Bananas/rotten animation + sound |
| `components/BoardEditorModal.tsx` | Standalone board editor; exports helpers used by SaveGameModal |
| `components/GameDetailModal.tsx` | Game detail view with board, word validity, definitions |
| `components/PlayerMultiSelect.tsx` | Player picker — shows signed-in user + their guests as `PlayerSlot`s |
| `utils/ocr.ts` | Full OCR pipeline — `runOCR(blob, onProgress?, signal?)` |
| `utils/auth.google.ts` | Google sign-in, logout, `subscribeAuthGate` |
| `utils/dictionary.ts` | CSW24 dictionary — lazy singleton, `loadDictionary()` returns `Set<string>` |
| `db/queries.firestore.ts` | All Firestore queries + shared types |
| `public/CSW24.txt` | 280k-word Scrabble dictionary served as static asset |
| `firestore.rules.txt` | Firestore security rules (deploy manually via Firebase console) |

---

## Feature 1: Rotten Banana Flow — COMPLETE

### Game phases in `split.tsx`

```
setup (mode) → setup (local | join) → lobby → playing → checking → ended → board_uploads → reset
```

**GamePhase type:** `"setup" | "lobby" | "playing" | "checking" | "ended" | "board_uploads"`

**Setup — mode picker:** Choose Local, Create Room, or Join Room.

**Setup — local:** `PlayerMultiSelect` (user + their guests as `PlayerSlot`s) + Add Guest sheet. SPLIT disabled until ≥1 slot selected.

**Timer:** `accMsRef` + `segStartRef` refs for pause/resume accuracy. `pauseTimer()` accumulates ms, `resumeTimer()` restarts segment, `snapshotElapsedMs()` reads total.

**Checking phase (Modal):** Sub-modes: `pick` → `options` → `manual`. "Scan Board" opens `SaveGameModal` in `mode="check"`. Cancel resumes timer.

**Results:**
- **Valid bananas**: `saveGame()` → `createGameFromSlots` → celebration → `board_uploads` phase
- **Rotten (>1 remaining)**: eliminate player, resume timer, rotten celebration
- **Rotten (last standing)**: set `pendingLastStanding`, queue rotten→bananas celebrations, show winner board upload prompt → `completePendingSave()` → `board_uploads` phase

**Board uploads phase (post-game):** After every game, ALL players (winner, rotten bananas, everyone) are shown a screen to optionally scan their board. Each row has Scan / Skip. Boards saved via `addPlayerBoard(gameId, playerUid, board)` which writes to `games/{id}.boards[playerUid]`. Winner who scanned during check is pre-marked "✓ Scanned". "Done" button resets to setup.

**Celebration sequencing:**
- `celebration` state + `queuedCelebration` for rotten→bananas chain
- `CelebrationOverlay` **must** have a `key` prop that changes between renders — `useEffect([])` won't re-fire on prop changes

### SaveGameModal modes

| mode | Steps | Validity check |
|---|---|---|
| `save` (default) | Scan → Edit → Players | Yes, determines celebration |
| `check` | Scan → Edit | Yes, returned to caller via `onCheckResult` |
| `upload` | Scan → Edit | No — board saved regardless |

`onCheckResult?: (result: { valid: boolean; board: StoredBoard | null }) => void`

---

## Feature 2: Auth + Friends — ~80% COMPLETE

### What's done

**Google Auth gate** (`app/_layout.tsx`): Entire app blocked behind Google sign-in. On sign-in, `getOrCreateUserProfile` is called eagerly. Loading spinner → sign-in screen → app.

**User profiles** (`db/queries.firestore.ts`): `UserProfile` type with `displayName`, `displayNameLower`, `email`, `photoURL`, `linkedPlayerId` (deprecated, ignore), `wins`, `losses`. `getOrCreateUserProfile`, `updateUserProfile`, `searchUsers` (prefix search on `displayNameLower`).

**Guests system**: `Guest` type — named player slots owned by a user. Stored at `users/{uid}/guests`. `listGuests`, `createGuest`, `deleteGuest`. Guests appear in `PlayerMultiSelect` and are tracked independently (their stats update via `createGameFromSlots`).

**Friends**: `FriendProfile` stored at `users/{uid}/friends/{friendUid}`. `getFriends`, `addFriend`, `removeFriend`. Friends screen has debounced search + add/remove UI.

**Game sessions** (room mode): Full `GameSession` type + CRUD. `createGameSession`, `getSessionByCode`, `joinGameSession`, `addSlotToSession`, `removeSlotFromSession`, `startSession`, `endSession`, `subscribeToSession` (real-time via `onSnapshot`).

**Lobby** (in `split.tsx`): Host creates room → gets 6-char join code → others join by code. Lobby shows two columns: Users (joined via code) and Guests. Host sees existing guests from `myGuests` as dashed rows — tap to add instantly. "+ New Guest" creates a new guest. Host can remove players with ✕. SPLIT button starts game for all.

**`createGameFromSlots`**: Saves games using `PlayerSlot[]` (users + guests) instead of legacy player IDs. Embeds `playerNames` + `winnerName` directly. Updates wins/losses on user profiles and guest docs. Returns the game ID (`string`). Also saves winner's board into `boards[winnerId]` map.

**`addPlayerBoard(gameId, playerUid, board)`**: Adds/updates `boards.<playerUid>` on an existing game doc (used by the post-game board uploads phase).

**Profile screen** (`app/(tabs)/profile.tsx`): Avatar, display name (editable), "Legacy Stats" button (navigates to stats tab), sign out.

**Home screen** (`app/(tabs)/index.tsx`): Win/loss leaderboard — signed-in user at top (tagged "You"), then their guests (tagged "Guest"), sorted by wins desc.

**Tab bar** (`app/(tabs)/_layout.tsx`): 4 tabs — Home, Split, Friends, Profile. Stats tab is registered but hidden from the bar (reachable via Profile → Legacy Stats). Tab bar uses `state.routes.findIndex(r => r.name === tab.name)` to resolve route indices — required because hidden screens shift indices.

### What's still needed

- **Legacy data migration** — transfer historical `players` collection stats to the new user/guest system (no design yet, discuss with user)
- The `linkedPlayerId` field on `UserProfile` exists but is unused in the UI (link player feature removed — was considered redundant given the new system)

---

## Data model (`db/queries.firestore.ts`)

### Firestore collections

| Collection | Purpose |
|---|---|
| `users/{uid}` | `UserProfile` — auth user profiles |
| `users/{uid}/guests/{id}` | `Guest` — named player slots owned by a user |
| `users/{uid}/friends/{uid}` | `FriendProfile` — friends list |
| `games/{id}` | `Game` — completed game records |
| `gameSessions/{id}` | `GameSession` — active/lobby room sessions |
| `players/{id}` | Legacy — read-only, used by stats screen only |

### Key types

```ts
type PlayerSlot = {
  type: "user" | "guest";
  uid: string;            // Firebase uid for users; guest doc id for guests
  ownerUid: string | null;
  ownerDisplayName: string | null;
  displayName: string;
  status: "active" | "eliminated" | "winner";
};

type Game = {
  id: string;
  playedAt: string;
  durationSeconds: number;
  playerIds: string[];
  playerNames: string[];   // embedded — no player lookup needed
  winnerId: string;
  winnerName: string;
  board?: StoredBoard;     // winner's board (backwards compat)
  boards?: Record<string, StoredBoard>; // all uploaded boards keyed by player uid
  eliminations?: Elimination[];
  outcome?: "bananas" | "last_standing";
};

type Elimination = {
  playerId: string;
  eliminatedAt: number; // elapsed ms
  reason: "rotten";
};

type GameSession = {
  id: string;
  hostUid: string;
  joinCode: string;        // 6-char unambiguous alphanumeric
  status: "lobby" | "active" | "ended";
  players: PlayerSlot[];
  timer: { startedAt: string | null; elapsed: number };
  eliminations: Elimination[];
  winnerId: string | null;
  outcome: "bananas" | "last_standing" | null;
  createdAt: string;
};
```

### Auth

`waitForAuthReady()` — module-level cached promise, resolves once Firebase rehydrates the persisted session. Called by `ensureAuthClientSide()` before every query. Prevents anonymous sign-in stomping a real session on startup.

---

## Architecture

### OCR pipeline (`utils/ocr.ts`)
- `runOCR(image: Blob, onProgress?: (identified, detected) => void, signal?: AbortSignal)`
- Throws `OCRCancelledError` if signal aborted
- Returns `{ tiles: OCRTile[], words: WordResult[], debugImageUrl: string }`
- **Tile detection**: `INK_MAX = 60` RGB threshold; connected components → blob filter → tile expansion → NMS → isolation filter → centroid outlier filter
- **Tesseract**: PSM 10 (single char) primary; PSM 8 fallback for 0% tiles
- `darkRatio > 0.75` → corrupted crop; `isBetterCrop` helper gates phase comparisons

### BoardEditorModal exports (used by SaveGameModal)
- `initGrid(tiles, words)` → `Map<CellKey, CellState>` with confidence per cell
- `deriveWordsFromGrid(cells)` → `StoredBoardWord[]`
- Types: `BoardCell`, `CellKey`, `CellState` (`confidence?: number`), `StoredBoardWord`

### CelebrationOverlay (`components/CelebrationOverlay.tsx`)
- Props: `type: "bananas" | "rotten"`, `playerName?: string`, `onDone: () => void`
- Sound: web → `HTMLAudioElement`; native → `expo-av`
- Confetti: `canvas-confetti` dynamic import (web only, bananas only)
- Auto-dismisses after 2.8s; tap to dismiss early
- **Always** provide a `key` prop that changes when type/content changes

### Stats screen (`app/(tabs)/stats.tsx`)
- Not in tab bar — reached via Profile → "Legacy Stats" button (`router.push("/(tabs)/stats")`)
- Game history: fixed 240px height, swipe-to-delete via `Swipeable`
- Board stats: Longest Word, Word Lengths pie chart, Most Common Words (top 4), Top 10 Letters bar chart
- `computeStats(games)` — SVG pie via `react-native-svg`
- Wrapped in `GestureHandlerRootView`
- Still reads from legacy `players` collection — considered deprecated

### Dictionary
- `utils/dictionary.ts` — singleton, fetched once via `fetch('CSW24.txt')`
- `loadDictionary()` → `Promise<Set<string>>` — safe to call multiple times

### Definition lookup (`GameDetailModal`)
- `GET https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
- Shows up to 3 part-of-speech groups, first definition + example per group

---

## Conventions

- All DB types from `db/queries.firestore.ts`
- Web-only code: `Platform.OS === "web"` guard or `.web.ts` file
- Object URLs tracked in `useRef<string[]>`, revoked on modal close / new scan
- No navigation library — modals are `<Modal>` with `visible` prop; Expo Router only used for tabs
- Haptics via `expo-haptics`
- Grid: `CELL=44` in SaveGameModal, `CELL=38` in GameDetailModal; `CELL_STEP = CELL + 2`; padding 8px
- Confidence colours: `<70%` burnt orange; OCR normal yellow; manual green; highlighted word purple
- All data screens use `useFocusEffect` (not `useEffect`) to reload on tab focus
- Tab bar resolves active route by `state.routes.findIndex(r => r.name === tab.name)` — never by array index, because hidden registered screens shift indices
- `PlayerMultiSelect` takes `me: UserProfile` + `guests: Guest[]`, returns `PlayerSlot`s via `onToggle`
- New games use `createGameFromSlots` (slot-based, embeds names). Legacy `createGame` still exists for the old player-ID-based flow but is not used for new games.
