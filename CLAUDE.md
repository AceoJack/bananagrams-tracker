# Bananagrams Tracker

Expo (React Native) app for tracking Bananagrams games. Runs primarily as a **web app** — most features use web-only APIs (canvas, File input, Tesseract.js).

See `docs/DESIGN-v2.md` for the full v2 feature design (rotten banana flow, game sessions, auth).

**Active branch: `feature/UIupdate`** — Feature 1 (rotten banana flow) complete. Feature 2 (auth + friends) complete. UI redesign complete. See status below.

---

## Stack

- **Expo** (SDK 53-ish) with Expo Router, static web output
- **Firebase** — Firestore for data, Google Auth (`utils/auth.google.ts`)
- **Tesseract.js** — OCR for reading board photos (web only)
- **canvas-confetti** — celebration animation on save
- **expo-av** — sound playback on native; `HTMLAudioElement` + `utils/sound.ts` on web
- **react-native-gesture-handler** — swipe-to-delete on game history rows
- `baseUrl: "/bananagrams-tracker"` in app.json (affects static asset paths)

---

## Key files

| Path | Purpose |
|---|---|
| `app/_layout.tsx` | Root layout — Google auth gate (blocks app until signed in) |
| `app/(tabs)/_layout.tsx` | Tab bar (Split, Friends, Profile) — custom animated tab bar |
| `app/(tabs)/split.tsx` | Full game flow: setup → lobby → playing → checking → board_uploads → reset |
| `app/(tabs)/index.tsx` | Redirects to `/split` (root "/" route) |
| `app/(tabs)/friends.tsx` | Friends screen — search users, add/remove friends |
| `app/(tabs)/profile.tsx` | Profile screen — avatar, edit display name, guests, friends, Legacy Stats link, sign out |
| `app/(tabs)/stats.tsx` | Legacy stats — game history + board stat cards (not in tab bar, reached via Profile) |
| `app/+html.tsx` | Sets `html, body, #root { background-color: #30302E }` — prevents white flash on web |
| `components/SaveGameModal.tsx` | Scan/edit wizard — modes: `save`, `check`, `upload` |
| `components/CelebrationOverlay.tsx` | Bananas/rotten animation + sound |
| `components/BoardEditorModal.tsx` | Standalone board editor; exports helpers used by SaveGameModal |
| `components/GameDetailModal.tsx` | Game detail view with board, word validity, definitions |
| `components/PlayerMultiSelect.tsx` | Player picker — shows signed-in user + their guests as `PlayerSlot`s |
| `components/AvatarCircle.tsx` | Solid (user) or dashed (guest) avatar circle, colour derived from uid |
| `components/FadeInView.tsx` | Fade-in wrapper; outer `View` has `backgroundColor: "#30302E"` to prevent white flash during tab transitions |
| `utils/ocr.ts` | Full OCR pipeline — `runOCR(blob, onProgress?, signal?)` |
| `utils/auth.google.ts` | Google sign-in, logout, `subscribeAuthGate` |
| `utils/dictionary.ts` | CSW24 dictionary — lazy singleton, `loadDictionary()` returns `Set<string>` |
| `utils/designSystem.ts` | Single source of truth for colours/radii — always use `C.*` |
| `utils/sound.ts` | Web audio utility — `unlockAudio()` + `playSound()` — fixes iOS Safari autoplay |
| `db/queries.firestore.ts` | All Firestore queries + shared types |
| `public/CSW24.txt` | 280k-word Scrabble dictionary served as static asset |
| `firestore.rules.txt` | Firestore security rules (deploy manually via Firebase console) |

---

## Design system

All colours/radii come from `utils/designSystem.ts` via `import { C } from "../../utils/designSystem"`.

Key tokens:
- `C.bg` / `C.surface` = `#30302E` (same — primary background)
- `C.surfaceSecondary` = `#3A3A38`
- `C.textPrimary` = `#F0F0F0`, `C.textSecondary` = `#AAAAAA`, `C.textTertiary` = `#666666`
- `C.border` = `#4A4A47`, `C.borderTertiary` = `#3D3D3B`
- `C.brand` = yellow, `C.brandText` = dark, `C.brandShadow` = dark yellow
- `C.info` / `C.infoBg`, `C.success` / `C.successBg`, `C.danger` / `C.dangerBg` / `C.dangerBorder`

**Never hardcode colours** — always use `C.*` tokens.

---

## Tab bar

`app/(tabs)/_layout.tsx` — 3 visible tabs: **Split**, **Friends**, **Profile**.
Hidden but routable: `index` (redirects to split), `stats` (legacy, reached via Profile).

- Tab bar background = `C.surface` = same as screen background (no visual separation)
- Active tab colour = `C.brandShadow`, inactive = `C.textTertiary`
- Uses `state.routes.findIndex(r => r.name === tab.name)` — never array index, because hidden screens shift indices

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

**Board uploads phase (post-game):** After every game, ALL players are shown a screen to optionally scan their board. Each row has Scan / Skip. Boards saved via `addPlayerBoard(gameId, playerUid, board)` which writes to `games/{id}.boards[playerUid]`. Winner who scanned during check is pre-marked "✓ Scanned". "Done" button resets to setup.

**`eliminatedBoards` state:** Boards scanned during the rotten check phase are stored in `eliminatedBoards: Record<string, StoredBoard>`. After `createGameFromSlots` creates the game ID, these are batch-saved via `addPlayerBoard`. This ensures rotten players' boards are captured even though they aren't the winner.

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

## Feature 2: Auth + Friends — COMPLETE

**Google Auth gate** (`app/_layout.tsx`): Entire app blocked behind Google sign-in. On sign-in, `getOrCreateUserProfile` is called eagerly.

**User profiles**: `UserProfile` type with `displayName`, `displayNameLower`, `email`, `photoURL`, `linkedPlayerId` (deprecated, ignore), `wins`, `losses`.

**Guests system**: `Guest` type — named player slots owned by a user. Stored at `users/{uid}/guests`. Guests appear in `PlayerMultiSelect` and are tracked independently.

**Friends**: `FriendProfile` stored at `users/{uid}/friends/{friendUid}`. Friends screen has debounced search + add/remove UI. Now a visible tab.

**Profile screen**: Avatar (`AvatarCircle`), inline name editing, stats grid (Games / Wins / Rotten / Win%), friends section (max 3 shown + Add Friend sheet), guests section (Add Guest sheet), "Game history" → stats tab, sign out (red `#8B2020` bg, `#FFAAAA` text).

---

## Room mode (multi-device)

### Session state machine

`SessionStatus = "lobby" | "active" | "checking" | "ended" | "closed"`

`GameSession` type includes:
- `checkingPlayerId: string | null` — who called BANANAS!
- `gameId: string | null` — written at `endSession`, lets non-host devices know which game doc to upload boards to
- `boardUploads: Record<string, "uploaded" | "skipped">` — real-time board upload status visible to all devices

### Key Firestore functions (beyond CRUD)

| Function | Purpose |
|---|---|
| `pauseSessionForChecking(sessionId, checkingPlayerId, elapsed)` | Sets `status: "checking"`, broadcasts who called BANANAS! |
| `resumeSessionAfterChecking(sessionId, elapsed)` | Sets `status: "active"` after rotten result, resumes timer |
| `endSession(sessionId, winnerId, outcome, elapsed, eliminations, gameId, boardUploads?)` | Sets `status: "ended"`, writes gameId + any already-uploaded boards atomically |
| `updateSessionBoardUpload(sessionId, playerUid, status)` | Dot-notation update to `boardUploads.{uid}` — triggers real-time sync |
| `closeSession(sessionId)` | Sets `status: "closed"` — signals non-host devices to show "Room closed" modal |

### Multi-device sync patterns

**Stale closure fix**: `phaseRef = useRef<GamePhase>()` synced via `useEffect([phase])`. All subscription callbacks read `phaseRef.current` instead of `phase` state.

**Who resolves the check**: Whoever called BANANAS! resolves it themselves (sets `checkingPlayerUid = myProfile.uid`). Others see a waiting spinner. Condition: `checkingPlayerUid !== myProfile?.uid` → show waiting view.

**Board uploads sync**: When any player scans/skips, `updateSessionBoardUpload` writes to Firestore. Both `handleCreateRoom` and `handleJoinRoom` subscription callbacks merge `s.boardUploads` into local `boardUploadStatus` when `phaseRef.current === "board_uploads"`.

**Transition + existing uploads**: The `"ended"` handler initialises statuses as all-pending then immediately merges `s.boardUploads` (`{ ...status, ...s.boardUploads }`) so any board already uploaded (e.g. winner scanned during check) is reflected on all devices from the start.

**Room closed**: Host calls `closeSession` when pressing Done on board uploads. Non-host subscription detects `status === "closed"` → shows `roomClosed` modal → user taps Done → `resetToSetup`.

---

## Sound (web / mobile)

**Problem**: iOS Safari blocks `audio.play()` called from `useEffect` because by then the user gesture context has been lost (many async ticks away from the original press).

**Fix** (`utils/sound.ts`):
- `unlockAudio()` — called synchronously in `handleBananas()` and `handleCheckResult()` (before any awaits). On first call, plays+immediately pauses each pre-loaded audio element, permanently unlocking Safari's audio context for the session.
- `playSound(key)` — resets `currentTime = 0` and calls `play()` on cached `HTMLAudioElement`. Used by `CelebrationOverlay` instead of creating new `Audio` instances.
- Audio elements are pre-loaded at module level (`preload = "auto"`, `el.load()`).

Native path (expo-av): `createAsync` then `playAsync` separately — more reliable than `shouldPlay: true` in `createAsync`.

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
  status: SessionStatus;   // "lobby" | "active" | "checking" | "ended" | "closed"
  players: PlayerSlot[];
  timer: { startedAt: string | null; elapsed: number };
  eliminations: Elimination[];
  winnerId: string | null;
  outcome: "bananas" | "last_standing" | null;
  checkingPlayerId: string | null;
  gameId: string | null;
  boardUploads: Record<string, "uploaded" | "skipped">;
  createdAt: string;
};
```

### Auth

`waitForAuthReady()` — module-level cached promise, resolves once Firebase rehydrates the persisted session. Called by `ensureAuthClientSide()` before every query. Prevents anonymous sign-in stomping a real session on startup.

### Firestore rules

`allow update: if request.auth != null` on `users/{uid}` — required so the host can write win/loss stats to other players' docs during `createGameFromSlots`. See `firestore.rules.txt`.

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
- Sound: web → `playSound()` from `utils/sound.ts`; native → `expo-av` (`createAsync` then `playAsync`)
- Confetti: `canvas-confetti` dynamic import (web only, bananas only)
- Auto-dismisses after 2.8s; tap to dismiss early
- **Always** provide a `key` prop that changes when type/content changes

### Stats screen (`app/(tabs)/stats.tsx`)
- Not in tab bar — reached via Profile → "Game history" button (`router.push("/(tabs)/stats")`)
- Game history: fixed 240px height, swipe-to-delete via `Swipeable`
- Board stats: Longest Word, Word Lengths pie chart, Most Common Words (top 4), Top 10 Letters bar chart
- Still reads from legacy `players` collection — considered deprecated
- **Note**: stats.tsx still uses hardcoded light colours — not yet themed to dark mode

### Dictionary
- `utils/dictionary.ts` — singleton, fetched once via `fetch('CSW24.txt')`
- `loadDictionary()` → `Promise<Set<string>>` — safe to call multiple times

### Definition lookup (`GameDetailModal`)
- `GET https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
- Shows up to 3 part-of-speech groups, first definition + example per group

---

## Conventions

- All DB types from `db/queries.firestore.ts`
- All colours/radii from `utils/designSystem.ts` via `C.*` — never hardcode colours
- Web-only code: `Platform.OS === "web"` guard or `.web.ts` file
- Object URLs tracked in `useRef<string[]>`, revoked on modal close / new scan
- No navigation library — modals are `<Modal>` with `visible` prop; Expo Router only used for tabs
- Haptics via `expo-haptics`
- Grid: `CELL=44` in SaveGameModal, `CELL=38` in GameDetailModal; `CELL_STEP = CELL + 2`; padding 8px
- Tile colours in board editor are semantic (yellow=OCR, orange=low-confidence, green=manual, purple=highlighted) — keep as-is even in dark mode since they represent physical game pieces
- Word chips: blue (`#1A2F45` / `#2F7FE3` / `#7BB8F5`) = horizontal, green (`#1A3325` / `#3D9B4D` / `#7EC98B`) = vertical, purple = selected, red = invalid
- All data screens use `useFocusEffect` (not `useEffect`) to reload on tab focus
- Tab bar resolves active route by `state.routes.findIndex(r => r.name === tab.name)` — never by array index, because hidden registered screens shift indices
- `PlayerMultiSelect` takes `me: UserProfile` + `guests: Guest[]`, returns `PlayerSlot`s via `onToggle`
- New games use `createGameFromSlots` (slot-based, embeds names). Legacy `createGame` still exists but is not used for new games.

---

## What's still needed

- **Legacy data migration** — transfer historical `players` collection stats to the new user/guest system (no design yet, discuss with user)
- **`stats.tsx` dark theme** — still uses hardcoded light colours; considered low priority as it's legacy-only
- The `linkedPlayerId` field on `UserProfile` exists but is unused in the UI (link player feature removed)
