# Bananagrams Tracker

Expo (React Native) app for tracking Bananagrams games. Runs primarily as a **web app** — most features use web-only APIs (canvas, File input, Tesseract.js).

See `docs/DESIGN-v2.md` for the full v2 feature design (rotten banana flow, game sessions, auth).

**Active branch: `feature/game-flow`** — Feature 1 (rotten banana flow) is complete. Starting Feature 2 (auth + friends) next.

## Stack

- **Expo** (SDK 53-ish) with Expo Router, static web output
- **Firebase** — Firestore for data, Auth (`db/queries.firestore.ts`)
- **Tesseract.js** — OCR for reading board photos (web only)
- **canvas-confetti** — celebration animation on save
- **expo-av** — sound playback on native; `HTMLAudioElement` on web
- **react-native-gesture-handler** — swipe-to-delete on game history rows
- `baseUrl: "/bananagrams-tracker"` in app.json (affects static asset paths)

## Key files

| Path | Purpose |
|---|---|
| `app/(tabs)/split.tsx` | Full game flow: setup → timer → checking → result |
| `app/(tabs)/stats.tsx` | Game history (swipeable rows) + board stat cards |
| `components/SaveGameModal.tsx` | Scan/edit wizard — modes: `save`, `check`, `upload` |
| `components/CelebrationOverlay.tsx` | Bananas/rotten animation + sound — reusable, accepts `playerName` |
| `components/BoardEditorModal.tsx` | Standalone board editor; also exports helpers used by SaveGameModal |
| `components/GameDetailModal.tsx` | Game detail view with board, word validity, definitions |
| `components/PlayerMultiSelect.tsx` | Checkbox-style player picker |
| `utils/ocr.ts` | Full OCR pipeline — `runOCR(blob, onProgress?, signal?)` |
| `utils/dictionary.ts` | CSW24 dictionary — lazy singleton, `loadDictionary()` returns `Set<string>` |
| `db/queries.firestore.ts` | All Firestore queries + shared types |
| `public/CSW24.txt` | 280k-word Scrabble dictionary served as static asset |

## Feature 1: Rotten Banana Flow (COMPLETE)

### Game flow in `split.tsx`

State machine: `setup → playing → checking → (bananas win | rotten → playing | last_standing)`

**Setup phase** (before SPLIT):
- Player list loaded via `useFocusEffect` (handles login-after-mount correctly)
- `PlayerMultiSelect` + `AddPlayerSheet` inline on screen
- SPLIT disabled until ≥1 player selected

**Timer:**
- `accMsRef` + `segStartRef` refs for pause/resume accuracy across segments
- `pauseTimer()` accumulates ms, `resumeTimer()` restarts segment, `snapshotElapsedMs()` reads total

**Checking phase (Modal):**
- Sub-modes: `pick` (who called?) → `options` (scan or manual?) → `manual` (valid/rotten buttons)
- "Scan Board" opens `SaveGameModal` in `mode="check"` — returns `{ valid, board }`
- Cancel resumes timer without elimination

**Results:**
- **Valid bananas**: `saveGame()` → `createGame` → bananas `CelebrationOverlay` → `resetToSetup()`
- **Rotten (>1 remaining)**: eliminate player, resume timer, show rotten overlay; timer keeps running
- **Rotten (last standing)**: set `pendingLastStanding`, queue rotten→bananas celebrations, then show board upload prompt
- **Last standing board upload**: winner can scan board (`mode="upload"`) or skip; `completePendingSave()` saves then resets

**Celebration sequencing:**
- `celebration` state + `queuedCelebration` state for rotten→bananas chain
- `CelebrationOverlay` must have a `key` prop that changes between rotten/bananas renders (otherwise `useEffect([])` doesn't re-run and the animation freezes)

### SaveGameModal modes

| mode | Steps | Button | Validity check |
|---|---|---|---|
| `save` (default) | Scan → Edit → Players | Next → / Save | Yes, determines celebration |
| `check` | Scan → Edit | Check Board → | Yes, returned to caller via `onCheckResult` |
| `upload` | Scan → Edit | Upload → | No — board saved regardless |

`onCheckResult?: (result: { valid: boolean; board: StoredBoard | null }) => void` — used by `check` and `upload` modes; caller handles outcome.

### Data model additions (`db/queries.firestore.ts`)

```ts
type Elimination = {
  playerId: string;
  eliminatedAt: number; // elapsed ms
  reason: "rotten";
};

// Added to Game:
eliminations?: Elimination[];
outcome?: "bananas" | "last_standing";
```

`createGame` accepts and writes `eliminations` + `outcome`. `listGames` reads them. `deleteGame` unchanged (doesn't reverse eliminations).

### Auth fix

`ensureAuthClientSide()` now calls `waitForAuthReady()` before checking `auth.currentUser`. This prevents `signInAnonymously` being called before Firebase rehydrates the persisted session (which would stomp over the real user with a new anonymous one). `_authReadyPromise` is module-level and cached — only one `onAuthStateChanged` listener is ever created.

---

## Architecture (existing)

### SaveGameModal — scan + edit flow
- Step 1 **Scan**: upload photo → OCR with live progress bar → annotated debug image
  - `ocrAbortRef` cancel button aborts via `AbortController`
- Step 2 **Edit Board**: inline grid editor, QWERTY keyboard, live word list with CSW24 validity
  - `KEY_SIZE = Math.min(34, floor((windowWidth - 64 - 9*KEY_GAP) / 10))`
  - Word tap → highlights cells + auto-scrolls grid
- Step 3 **Players** (`save` mode only): multi-select + winner pick → `createGame` → celebration

### BoardEditorModal exports (used by SaveGameModal)
- `initGrid(tiles, words)` → `Map<CellKey, CellState>` with confidence per cell
- `deriveWordsFromGrid(cells)` → `StoredBoardWord[]`
- Types: `BoardCell`, `CellKey`, `CellState` (`confidence?: number`), `StoredBoardWord`

### OCR pipeline (`utils/ocr.ts`)
- `runOCR(image: Blob, onProgress?: (identified, detected) => void, signal?: AbortSignal)`
- Throws `OCRCancelledError` if signal aborted
- Returns `{ tiles: OCRTile[], words: WordResult[], debugImageUrl: string }`
- **Tile detection**: `INK_MAX = 60` RGB threshold; connected components → blob filter → tile expansion → NMS → isolation filter → centroid outlier filter
- **Tesseract**: PSM 10 (single char) primary; PSM 8 fallback for 0% tiles
- `darkRatio > 0.75` → corrupted crop; `isBetterCrop` helper gates phase comparisons

### Stats screen (`app/(tabs)/stats.tsx`)
- Game history: fixed 240px height, swipe-to-delete via `Swipeable`
- Board stats: Longest Word, Word Lengths pie chart, Most Common Words (top 4), Top 10 Letters bar chart
- `computeStats(games)` — SVG pie via `react-native-svg`
- Wrapped in `GestureHandlerRootView`

### CelebrationOverlay (`components/CelebrationOverlay.tsx`)
- Props: `type: "bananas" | "rotten"`, `playerName?: string`, `onDone: () => void`
- Sound: web → `HTMLAudioElement`; native → `expo-av`
- Confetti: `canvas-confetti` dynamic import (web only, bananas only)
- Auto-dismisses after 2.8s; tap to dismiss early
- **Important**: always provide a `key` prop that changes when celebration type/content changes — `useEffect([])` won't re-run on prop changes

### Dictionary
- `utils/dictionary.ts` — singleton, fetched once via `fetch('CSW24.txt')`
- `loadDictionary()` → `Promise<Set<string>>` — safe to call multiple times

### Definition lookup (`GameDetailModal`)
- `GET https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
- Shows up to 3 part-of-speech groups, first definition + example per group

### Firestore (`db/queries.firestore.ts`)
- `listPlayers()`, `createPlayer(name)`, `listGames()`, `createGame(input)`, `deleteGame(game)`
- `deleteGame` — transaction: deletes game doc + reverses win/loss counts (floored at 0)
- Auth: `waitForAuthReady()` (module-level cached promise) + `ensureAuthClientSide()` called before every query

## Conventions

- All DB types from `db/queries.firestore.ts`
- Web-only code: `Platform.OS === "web"` guard or `.web.ts` file
- Object URLs tracked in `useRef<string[]>`, revoked on modal close / new scan
- No navigation library — modals are `<Modal>` with `visible` prop
- Haptics via `expo-haptics`
- Grid: `CELL=44` in SaveGameModal, `CELL=38` in GameDetailModal; `CELL_STEP = CELL + 2`; padding 8px
- Confidence colours: `<70%` burnt orange; OCR normal yellow; manual green; highlighted word purple
- Player list screens use `useFocusEffect` (not `useEffect`) to reload data — handles login-after-mount
