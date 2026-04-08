# Bananagrams Tracker

Expo (React Native) app for tracking Bananagrams games. Runs primarily as a **web app** — most features use web-only APIs (canvas, File input, Tesseract.js). **`firebase` is the active branch.**

## Stack

- **Expo** (SDK 53-ish) with Expo Router, static web output
- **Firebase** — Firestore for data, anonymous Auth (`db/queries.firestore.ts`)
- **Tesseract.js** — OCR for reading board photos (web only)
- **canvas-confetti** — celebration animation on save
- **expo-av** — sound playback on native; `HTMLAudioElement` on web
- **react-native-gesture-handler** — swipe-to-delete on game history rows
- `baseUrl: "/bananagrams-tracker"` in app.json (affects static asset paths)

## Key files

| Path | Purpose |
|---|---|
| `app/(tabs)/split.tsx` | Timer + SPLIT/BANANAGRAMS button → opens SaveGameModal |
| `app/(tabs)/stats.tsx` | Game history (swipeable rows) + board stat cards |
| `components/SaveGameModal.tsx` | 3-step wizard: scan → edit board → players/save |
| `components/BoardEditorModal.tsx` | Standalone board editor; also exports helpers used by SaveGameModal |
| `components/GameDetailModal.tsx` | Game detail view with board, word validity, definitions |
| `utils/ocr.ts` | Full OCR pipeline — `runOCR(blob, onProgress?, signal?)` |
| `utils/dictionary.ts` | CSW24 dictionary — lazy singleton, `loadDictionary()` returns `Set<string>` |
| `db/queries.firestore.ts` | All Firestore queries + shared types (`Player`, `Game`, `StoredBoard`) |
| `public/CSW24.txt` | 280k-word Scrabble dictionary served as static asset |

## Architecture

### SaveGameModal — 3-step wizard
1. **Scan** — upload photo → OCR with live progress bar → annotated debug image after scan
   - `ocrAbortRef = useRef<AbortController | null>()` — cancel button calls `ocrAbortRef.current?.abort()`
   - Catches `OCRCancelledError` silently; other errors shown inline
2. **Edit Board** — inline grid editor, QWERTY keyboard (responsive: `KEY_SIZE = Math.min(34, floor((windowWidth - 64 - 9*KEY_GAP) / 10))`), live word list with CSW24 validity, word tap → highlights cells + auto-scrolls grid
3. **Players** — multi-select players, pick winner, save → celebration overlay

### BoardEditorModal exports (used by SaveGameModal)
- `initGrid(tiles, words)` → `Map<CellKey, CellState>` with confidence per cell
- `deriveWordsFromGrid(cells)` → `StoredBoardWord[]`
- Types: `BoardCell`, `CellKey`, `CellState` (`confidence?: number`), `StoredBoardWord`

### OCR pipeline (`utils/ocr.ts`)
- `runOCR(image: Blob, onProgress?: (identified, detected) => void, signal?: AbortSignal)`
- Throws `OCRCancelledError` if signal aborted (import it alongside `runOCR`)
- Returns `{ tiles: OCRTile[], words: WordResult[], debugImageUrl: string }`
- **Tile detection**: fixed `INK_MAX = 60` RGB threshold (targets near-black letter ink); connected components → blob filter → tile expansion → NMS → isolation filter → centroid outlier filter
  - Centroid filter: drops tiles > `max(tileSize*4, medDist*3)` from cluster centroid (removes far-away false positives)
  - Blob filter: `minH = w/80`, aspect ratio min `0.06`, fill factor `0.03`
- **Tesseract**: PSM 10 (single char) primary; PSM 8 (single word) phase-4 fallback for 0% tiles
- `darkRatio` metric: crops with inner dark ratio > 0.75 treated as corrupted; `isBetterCrop` helper gates phase comparisons
- Progress: fires `onProgress(0, N)` when rects detected, then `onProgress(i+1, N)` per tile

### Stats screen (`app/(tabs)/stats.tsx`)
- Game history: fixed 240px height with inner `ScrollView`, swipe-to-delete via `Swipeable`
  - `confirmDelete`: `window.confirm` on web, `Alert.alert` on native
  - `handleDelete`: calls `deleteGame(game)` → optimistically removes from state
- Board stats (shown when any game has board data): Longest Word, Word Lengths pie chart, Most Common Words (top 4), Top 10 Letters bar chart
- `computeStats(games)` derives all stats; SVG pie via `react-native-svg`
- Wrapped in `GestureHandlerRootView`

### Celebration overlay (`SaveGameModal`)
- After save: all words valid (or no words) → `"bananas"` (confetti + popup); any invalid → `"rotten"` (popup, no confetti)
- Sound: web → `new window.Audio(url).play()`; native → `Audio.setAudioModeAsync({ playsInSilentModeIOS: true })` + `Audio.Sound.createAsync(source, { shouldPlay: true })`
- Assets: `assets/sounds/bananas.mp3`, `assets/sounds/rotten-bananas.mp3`, `assets/images/rotten-bananas.png`
- `canvas-confetti` imported dynamically (web only)

### Dictionary
- `utils/dictionary.ts` — singleton, fetched once via `fetch('CSW24.txt')`
- `loadDictionary()` → `Promise<Set<string>>` — safe to call multiple times

### Definition lookup (`GameDetailModal`)
- `GET https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
- Shows up to 3 part-of-speech groups, first definition + example per group

### Firestore (`db/queries.firestore.ts`)
- Types: `Player`, `Game`, `StoredBoard`
- `deleteGame(game)` — transaction: deletes game doc + reverses win/loss counts for all players (floored at 0)

## Conventions

- All DB types from `db/queries.firestore.ts`
- Web-only code: `Platform.OS === "web"` guard or `.web.ts` file
- Object URLs tracked in `useRef<string[]>`, revoked on modal close / new scan
- No navigation library — modals are `<Modal>` with `visible` prop
- Haptics via `expo-haptics`
- Grid: `CELL=44` in SaveGameModal, `CELL=38` in GameDetailModal; `CELL_STEP = CELL + 2`; padding 8px
- Confidence colours: `<70%` burnt orange; OCR normal yellow; manual green; highlighted word purple
