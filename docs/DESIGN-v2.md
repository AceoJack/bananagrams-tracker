# V2 Feature Design — Rotten Banana Flow, Game Sessions & Auth

Reference this from `CLAUDE.md`:
```
See docs/DESIGN-v2.md for the v2 feature design (rotten banana flow, game sessions, auth).
```

---

## Feature 1: Rotten Banana Game Flow

### Rules (official Bananagrams)
- When a player calls "Bananas!" the other players inspect their grid.
- If all words are valid → that player wins ("Top Banana"), game ends.
- If any word is invalid → that player is a "Rotten Banana", is **eliminated** from the hand, and returns all tiles face-down to the bunch.
- The remaining players **continue playing** until someone else calls Bananas or only one player remains.
- The timer does NOT stop on a rotten banana — it only stops on a valid win or when no players remain.

### State changes

**New game states** (extend the split.tsx timer screen):
```
playing → checking → (bananas | rotten)
                         ↓          ↓
                       ended    playing (resume)
```

- `playing`: Timer running. BANANAS button visible.
- `checking`: Timer **paused**. The calling player scans/enters their board. Other players wait.
- `bananas`: Board valid → game ends, save as win.
- `rotten`: Board invalid → player eliminated, timer resumes for remaining players.

**Timer behaviour:**
- On "BANANAS!" press: record `pausedAt = Date.now()`, pause timer display.
- On rotten result: `elapsed += (Date.now() - pausedAt)`, resume timer.
- On valid result: `finalElapsed = elapsed + (Date.now() - pausedAt)`, stop.

### Data model changes

```ts
// Extend the Game type in db/queries.firestore.ts

interface Elimination {
  playerId: string;
  eliminatedAt: number;   // elapsed ms at elimination
  boardId?: string;        // ref to stored board (optional)
  reason: 'rotten';
}

// Add to Game:
interface Game {
  // ... existing fields ...
  eliminations: Elimination[];
  outcome: 'bananas' | 'last_standing'; // how the game ended
}
```

### UI changes to split.tsx

1. **BANANAS button** → pauses timer, opens a "checking" overlay.
2. **Checking overlay** has two paths:
   - "Scan Board" → opens SaveGameModal in check-only mode (scan → edit → validate → result).
   - "Manual Check" → quick yes/no if players don't want to scan.
3. **Result:**
   - Valid → celebration overlay (existing "bananas" flow), game saves.
   - Invalid → "Rotten Banana!" overlay (existing "rotten" animation), player name shown as eliminated, timer resumes.
4. **Eliminated players list** shown on timer screen (greyed-out names with elimination time).
5. **Auto-end:** If only one player remains after an elimination, that player wins by default (`outcome: 'last_standing'`).

### SaveGameModal changes

- Add a `mode` prop: `'save'` (existing) | `'check'` (new).
- In `'check'` mode: skip the players step, just do scan → edit → return `{ valid: boolean, board: StoredBoard }`.
- The calling screen (split.tsx) handles the outcome.

---

## Feature 2: Game Sessions, Multi-Device Boards & Auth

### 2a. Email-based authentication (passwordless OTP)

**Flow:**
1. User enters email + display name on sign-up screen.
2. Firebase Cloud Function (`sendAuthCode`) generates a 6-digit code, stores it in Firestore (`authCodes/{email}`) with 10-minute expiry, and emails it.
3. User enters code on the app.
4. Cloud Function (`verifyAuthCode`) validates → creates Firebase Auth user (or signs in existing) → returns custom token.
5. App calls `signInWithCustomToken(token)`.

**Sign-in** is the same flow minus the display name step.

**Migration from anonymous auth:**
- If a user is currently anonymous and signs up, link accounts via `linkWithCredential` to preserve game history.
- Prompt on first app open: "Create an account to play with friends" with a "Continue as guest" option (stays anonymous).

**New files:**
| File | Purpose |
|---|---|
| `app/auth/signup.tsx` | Email + name form → code entry → account created |
| `app/auth/login.tsx` | Email form → code entry → signed in |
| `functions/sendAuthCode.ts` | Cloud Function: generate code, store in Firestore, send email |
| `functions/verifyAuthCode.ts` | Cloud Function: validate code, create/sign-in user, return custom token |

**Email sending:** Use Firebase Extensions (Trigger Email) or a service like SendGrid/Resend via Cloud Functions. The email contains just the 6-digit code — no links needed.

### 2b. User profiles

**Firestore: `users/{uid}`**
```ts
interface UserProfile {
  displayName: string;
  email: string;
  avatarColor: string;       // assigned on creation (from a preset palette)
  stats: {
    wins: number;
    losses: number;
    gamesPlayed: number;
    rottenBananas: number;   // times eliminated
  };
  friends: string[];          // uids of frequent players
  createdAt: Timestamp;
}
```

- Created automatically on first sign-up.
- `avatarColor` is randomly assigned from a set of 8-10 distinct colors (used for lobby avatars — initials on colored circle).
- `friends` populated automatically: after playing a game with someone, both users are added to each other's friends list (for quick "invite" in future lobbies).

### 2c. Game session (lobby → play → boards)

#### Lifecycle

```
lobby → active → checking → ended
                    ↕
                 (rotten → active again)
```

**Firestore: `gameSessions/{id}`**
```ts
interface GameSession {
  id: string;
  hostUid: string;
  joinCode: string;           // 6-char alphanumeric, unique, uppercase
  status: 'lobby' | 'active' | 'checking' | 'ended';
  
  players: PlayerSlot[];
  
  timer: {
    startedAt: Timestamp | null;
    pausedAt: Timestamp | null;
    elapsed: number;            // accumulated ms (excluding pauses)
  };
  
  eliminations: Elimination[];  // from Feature 1
  winnerId: string | null;
  outcome: 'bananas' | 'last_standing' | null;
  
  createdAt: Timestamp;
  endedAt: Timestamp | null;
}

interface PlayerSlot {
  type: 'authenticated' | 'guest';
  uid: string;                  // for authenticated: Firebase uid. For guest: auto-generated id.
  displayName: string;
  avatarColor: string;
  status: 'active' | 'eliminated' | 'winner';
}

// Subcollection: gameSessions/{id}/boards/{playerId}
// Uses existing StoredBoard type
```

#### Lobby phase (`status: 'lobby'`)

**New file: `app/(tabs)/lobby.tsx`** (or a modal/screen within the existing tab structure)

**Host creates game:**
1. Tap "New Game" → writes `gameSession` doc with `status: 'lobby'`.
2. `joinCode` generated: 6 random uppercase alphanumeric chars. Checked for uniqueness against active sessions.
3. Host sees lobby screen with their name, a share code displayed prominently, and a "Add Guest" button.

**Players join:**
1. Open app → "Join Game" → enter 6-char code.
2. App queries `gameSessions` where `joinCode == code && status == 'lobby'`.
3. Adds their `PlayerSlot` to the `players` array (Firestore `arrayUnion`).
4. All devices update via `onSnapshot` listener on the session doc.

**Add guest:**
- Host taps "Add Guest" → enters a name → a `PlayerSlot` with `type: 'guest'` is added.
- Guest has an auto-generated uid (e.g. `guest_${nanoid(8)}`), no Firebase auth.

**Lobby UI:**
- Player list with avatar circles (initials + color), name, and "remove" button (host only).
- Player count shown (e.g. "4 players").
- "Start Game" button (host only, enabled when ≥2 players).
- Join code displayed large + "Share" button (copies link or code).

#### Active phase (`status: 'active'`)

- Host taps "Start Game" → `status` changes to `active`, `timer.startedAt = serverTimestamp()`.
- All connected devices transition to timer screen.
- Timer is derived from `serverTimestamp() - startedAt + elapsed` so all devices show roughly the same time.
- The host's device is the authority for pause/resume actions.

#### Checking phase (integrates Feature 1)

- Any player can tap "BANANAS!" on their device → `status` changes to `checking`, `timer.pausedAt = serverTimestamp()`.
- The calling player's device opens the board scan flow.
- Other players' devices show "Checking [Player Name]'s board..."
- Result:
  - Valid → `status: 'ended'`, player marked as winner.
  - Rotten → player marked as eliminated, `status: 'active'`, timer resumes.

#### Board entry phase (after game ends)

- When `status: 'ended'`, all authenticated players see "Scan your board" prompt.
- Each player uses the existing SaveGameModal (scan → edit → submit) on their own device.
- Board is written to `gameSessions/{id}/boards/{playerUid}`.
- Guest boards: host scans them, selecting which guest they belong to from a dropdown.
- **Host dashboard (`BoardSubmissionDashboard.tsx`):**
  - Shows each player with status: "Submitted" / "Pending" / "Skipped".
  - Tap a submitted board to view it (GameDetailModal).
  - "Finalise Game" button when ready → writes the final `Game` record (for stats), copies boards to the game doc.

### 2d. New files summary

| File | Purpose |
|---|---|
| `app/auth/signup.tsx` | Sign-up: email + name → MFA code → account |
| `app/auth/login.tsx` | Sign-in: email → MFA code → session |
| `app/(tabs)/lobby.tsx` | Create/join game, player list, start game |
| `components/LobbyPlayerList.tsx` | Real-time player list with avatars, guest management |
| `components/JoinGameModal.tsx` | Enter join code, shows joining state |
| `components/BoardSubmissionDashboard.tsx` | Host view: track which players submitted boards |
| `functions/sendAuthCode.ts` | Cloud Function: generate + email 6-digit code |
| `functions/verifyAuthCode.ts` | Cloud Function: verify code, issue custom token |
| `db/queries.firestore.ts` | Extended: session CRUD, user profiles, board subcollection queries |

### 2e. Firestore security rules (key rules)

```
match /gameSessions/{sessionId} {
  // Anyone authenticated can read sessions they're part of
  allow read: if request.auth != null && 
    request.auth.uid in resource.data.players.map(p => p.uid);
  
  // Host can update session state
  allow update: if request.auth.uid == resource.data.hostUid;
  
  // Anyone authenticated can create a session (becomes host)
  allow create: if request.auth != null;
  
  match /boards/{playerId} {
    // Players can write their own board
    allow write: if request.auth.uid == playerId || 
      request.auth.uid == get(/databases/$(database)/documents/gameSessions/$(sessionId)).data.hostUid;
    allow read: if request.auth != null;
  }
}

match /users/{uid} {
  allow read: if request.auth != null;
  allow write: if request.auth.uid == uid;
}
```

---

## Migration path (suggested implementation order)

1. **Auth system** — sign-up/login screens, Cloud Functions, user profiles. Keep anonymous auth working alongside.
2. **Game sessions (lobby)** — create/join/guest flow. Timer still runs locally on host.
3. **Rotten banana flow** — extend timer screen with pause/check/resume. Works in both solo (no session) and session modes.
4. **Multi-device boards** — board subcollection, submission dashboard, per-player scan on own device.
5. **Real-time timer sync** — move timer to Firestore so all devices show the same time (can defer this — local timer on host works for v1 of sessions).
