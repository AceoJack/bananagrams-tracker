# Bananagrams Tracker — V2 UI/UX Design Specification

> This document is the single source of truth for the v2 redesign.
> Reference from `CLAUDE.md`: `See docs/DESIGN-v2.md for the v2 UI/UX design spec.`

---

## Table of contents

1. [Design system](#1-design-system)
2. [Page map & navigation](#2-page-map--navigation)
3. [Screen specifications](#3-screen-specifications)
4. [Data model](#4-data-model)
5. [Game flow state machine](#5-game-flow-state-machine)
6. [File map](#6-file-map)
7. [Firestore security rules](#7-firestore-security-rules)
8. [Implementation order](#8-implementation-order)

---

## 1. Design system

### 1.1 Colour palette

**Brand colour (banana yellow):**
- Primary: `#F5C842`
- Shadow/pressed: `#D4A820`
- Text on yellow: `#4A3800`

**Avatar colours** (7 presets, used for user/guest initials circles):
| Name     | Background | Text colour |
|----------|------------|-------------|
| Blue     | `#85B7EB`  | `#042C53`   |
| Green    | `#97C459`  | `#173404`   |
| Coral    | `#F0997B`  | `#4A1B0C`   |
| Purple   | `#AFA9EC`  | `#26215C`   |
| Pink     | `#ED93B1`  | `#4B1528`   |
| Amber    | `#FAC775`  | `#412402`   |
| Gray     | `#B4B2A9`  | `#2C2C2A`   |

**Eliminated/rotten red:**
- Background: `#F09595`
- Text: `#501313`

### 1.2 Component patterns

**Avatar circle (authenticated user):**
- Solid circle, `border-radius: 50%`
- Shows 2-letter uppercase initials (first + last initial, or first 2 chars of name)
- Size: 36px in lists, 64px on profile header, 72px on friend profile, 22px as inline chip
- Background from avatar colour palette, text colour from same row
- Online indicator: 10px green circle, positioned bottom-right, with 2px white border

**Avatar circle (guest):**
- Same sizing as authenticated but with `border: 0.5px dashed` using a secondary border colour
- Background is transparent/secondary (muted)
- Initials use a secondary text colour
- This dashed-border pattern is used EVERYWHERE guests appear: lobby, timer chips, profile, board submission

**Player chip (inline during game):**
- Horizontal pill: 22px avatar + name text
- `border-radius: 99px`, background: secondary surface
- Guest chips additionally have `border: 0.5px dashed` on the outer pill
- Eliminated chips: red background tint, `text-decoration: line-through`, `opacity: 0.6`

**Stat card (metric):**
- `background: secondary surface`, `border-radius: 8px`, `padding: 10px 8px`
- Number: 20px, font-weight 500
- Label: 10px, tertiary colour, 2px margin-top
- Used in a 4-column grid with 8px gap

**Bottom sheet modal:**
- Full-width, anchored to bottom, `border-radius: 20px 20px 0 0`
- 36×4px drag handle centred at top, secondary border colour, `border-radius: 2px`, `margin-bottom: 20px`
- Background dimmer: `rgba(0,0,0,0.4)` overlay behind
- Content padding: `16px 20px 32px`

**List row:**
- `padding: 10px 0` (vertical only — horizontal padding comes from parent)
- `border-bottom: 0.5px solid` tertiary border
- 36px avatar + 12px gap + flex-1 text block + optional trailing action
- Title: 14px, font-weight 500
- Subtitle: 11px, tertiary colour

**Action button (primary):**
- Full width, `padding: 14px`, `text-align: center`
- Background: `#F5C842`, text: `#4A3800`, font-size: 16px/15px, font-weight: 500
- `border-radius: 12px` (border-radius-lg)
- Disabled state: secondary background, tertiary text, `cursor: not-allowed`

**Secondary button / link:**
- `border: 0.5px solid` secondary border, transparent background
- Same border-radius and padding as primary
- Text: secondary colour

### 1.3 Typography

- Timer display: 56-64px, font-weight 500, `letter-spacing: -2px`, `font-variant-numeric: tabular-nums`
- Screen title: 16-18px, font-weight 500
- Section header: 15px, font-weight 500
- Body/list title: 14px, font-weight 500
- Body text: 13px, normal weight
- Caption/label: 11-12px, tertiary colour
- Room code display: 48px, font-weight 500, `letter-spacing: 8px`, monospace font
- Code input cells: 24px, font-weight 500, monospace

### 1.4 Tab bar

3 tabs, fixed at bottom:
1. **Split** — timer icon (circle + clock hands), label "Split"
2. **Stats** — bar chart icon (3 ascending bars), label "Stats"
3. **Profile** — person icon (head + shoulders), label "Profile"

Active tab: banana yellow (`#D4A820`) icon + label with font-weight 500.
Inactive tab: tertiary colour icon + label.
Tab bar has `border-top: 0.5px solid` tertiary border, `padding: 8px 0 20px` (extra bottom for safe area).

---

## 2. Page map & navigation

### 2.1 Top-level tabs

```
[Split]          [Stats]           [Profile]
   │                │                  │
   ▼                ▼                  ▼
Split screen    Game history      Profile screen
```

### 2.2 Full navigation tree

```
Split tab (idle)
  └─ Tap SPLIT button → Game Mode Picker (bottom sheet modal)
       ├─ "Create room" → Lobby (host view) → Timer (room) → Bananas! check
       ├─ "Local game" → Timer (local) → Bananas! check
       └─ "Join a room" → Join Game Modal → Lobby (player view) → Timer (room)
  └─ "Join a game room" link → Join Game Modal

Timer (both modes)
  └─ Tap BANANAS! → Checking overlay
       ├─ "Scan their board" → SaveGameModal (check mode)
       ├─ "Valid" quick button → Top Banana → Board Submission Dashboard (room) / SaveGameModal (local)
       └─ "Rotten" quick button → Elimination banner → Timer resumes

Board Submission Dashboard (room games, host only)
  └─ Per-player: "View" → GameDetailModal, "Scan" → SaveGameModal
  └─ "Finalise game" → saves to Firestore

Stats tab
  └─ Game history list (existing)
       └─ Tap row → GameDetailModal (existing)

Profile tab
  ├─ "Edit" → Edit Profile (inline or modal — TBD)
  ├─ "Add friend" → Add Friend (bottom sheet modal)
  │    └─ Search results → tap "Add" → friend added
  ├─ Tap friend row → Friend Profile (push screen)
  │    └─ "Invite to game" → creates room, pre-adds friend
  │    └─ "Remove" → confirmation → removes friend
  ├─ "Add guest" → Add Guest (bottom sheet modal)
  │    └─ Name + colour picker → "Create guest"
  ├─ Tap guest row → Guest Detail (push screen)
  ├─ "Game history" → Stats tab
  ├─ "Settings" → Settings screen (TBD)
  └─ "Sign out" → confirmation → returns to auth
```

---

## 3. Screen specifications

Every screen below describes the exact layout from top to bottom. Dimensions use the conventions: "36px avatar" means width and height are both 36px. "12px gap" means the gap between adjacent elements.

---

### 3.1 Split tab — idle state

**Purpose:** The home screen. Shows timer at 00:00, the big SPLIT button, and a secondary "Join" link.

**Layout (top to bottom, centred column):**

1. **Timer display:** `00:00` — 64px, weight 500, tabular-nums, primary text colour
2. **Helper text:** "Tap SPLIT to start a game" — 13px, tertiary colour, 4px below timer
3. **SPLIT button** (32px below helper text):
   - 160×160px circle, background `#F5C842`, `box-shadow: 0 2px 0 #D4A820`
   - Text "SPLIT!" — 28px, weight 500, colour `#4A3800`, `letter-spacing: 2px`
4. **Join link** (below button, separated by natural spacing):
   - Horizontal row: 16×16 plus icon + "Join a game room" text
   - `padding: 12px 20px`, `border: 0.5px solid` secondary border, `border-radius: 12px`
   - Text: 14px, secondary colour

Everything is vertically centred in the available space between header and tab bar.

---

### 3.2 Game mode picker (bottom sheet modal)

**Trigger:** User taps the SPLIT button on idle screen.

**Content (inside bottom sheet):**

1. **Title:** "Start a game" — 18px, weight 500
2. **Subtitle:** "Choose how you want to play" — 13px, secondary colour, 4px below title, 20px margin-bottom

3. **Option card: Create room** — `border: 0.5px solid` tertiary border, `border-radius: 12px`, `padding: 16px`, `margin-bottom: 12px`
   - Row layout: icon box (44×44px, `border-radius: 12px`, info-blue background, multi-person SVG icon in info-blue) → 14px gap → text block → chevron-right icon (trailing)
   - Title: "Create room" — 15px, weight 500
   - Description: "Share a code so friends can join from their own phones and scan their own boards" — 13px, secondary colour, `line-height: 1.4`

4. **Option card: Local game** — same structure as above
   - Icon box: amber/warning background, single-device SVG icon
   - Title: "Local game"
   - Description: "Timer on this device only. Enter everyone's boards yourself after the game"

5. **Join link** (centred, 8px padding-top):
   - "Have a code? " (13px, secondary) + "Join a room" (13px, info-blue, weight 500, tappable)

---

### 3.3 Join game modal (bottom sheet)

**Trigger:** "Join a room" from the mode picker, or "Join a game room" from idle screen.

**Content:**

1. **Title:** "Join a game" — 18px, weight 500
2. **Subtitle:** "Enter the room code from the host's screen" — 13px, secondary colour, 24px margin-bottom

3. **Code input:** 6 individual character cells in a horizontal row, 8px gap
   - Each cell: 44×56px, `border: 0.5px solid` tertiary border, `border-radius: 8px`
   - Filled cells: secondary border, 24px monospace text, weight 500
   - Active cell (currently focused): `border: 2px solid` info-blue, info-blue background tint
   - Empty cells: tertiary border, underscore placeholder in 16px tertiary colour
   - Auto-advances focus as characters are typed. Backspace moves back.

4. **Join button** (24px below input): Full-width primary button, disabled until all 6 characters entered
5. **Helper:** "You'll join once the host starts the game" — 11px, tertiary, centred, 12px margin-top

---

### 3.4 Lobby — host view

**Purpose:** After "Create room" — shows room code prominently, player list, and start button.

**Header bar:**
- Back chevron (left) → dismisses to idle
- Title: "Game lobby" — 16px, weight 500
- Trailing badge: "Host" — 12px, green pill (success background + success text, `border-radius: 99px`, `padding: 3px 10px`)

**Room code hero section** (below header, full-width, secondary background):
- Label: "ROOM CODE" — 12px, secondary colour, `text-transform: uppercase`, `letter-spacing: 1.5px`
- Code: e.g. "BAN42X" — 48px, weight 500, `letter-spacing: 8px`, monospace, primary text
- 12px below code, a row of 2 buttons centred:
  - "Copy" button: 13px, secondary text, `border: 0.5px solid` secondary, `border-radius: 8px`, `padding: 6px 14px`, copy icon (14px) on left
  - "Share" button: same style, share/upload icon on left

**Player list section:**
- Section label: "Players (N)" — 13px, secondary colour, 12px margin-bottom
- Each player is a list row (see §1.2):
  - **Host player:** avatar + name + subtitle "You (host)". No remove button.
  - **Authenticated player:** avatar + name + subtitle "Joined". Remove button (X icon, tertiary) trailing.
  - **Guest player:** dashed-border avatar + name (secondary text colour) + subtitle "Guest". Remove button trailing.
- **Add guest row** at bottom: dashed-border circle (36px) with plus icon (info-blue) + "Add guest" text (14px, info-blue)

**Footer:**
- "Start game" primary button (full width). Disabled state if <2 players.

---

### 3.5 Lobby — player view (non-host)

Identical to host view except:
- No "Host" badge — instead nothing or "Player" badge
- Room code section: visible but no Copy/Share buttons (players already have the code)
- No remove (X) buttons on any player rows
- No "Add guest" row
- "Start game" button replaced with: "Waiting for host to start..." — 14px, secondary colour, centred text (not a button)
- When host starts, this screen auto-transitions to the timer screen

---

### 3.6 Timer — active game (room or local)

**Header bar:**
- Room mode: "Room: BAN42X" (14px, weight 500) on left, "N players" green pill on right
- Local mode: "Local game" on left, no pill

**Rotten banana banner** (conditional — shown only after an elimination):
- Full-width bar, danger background
- Row: banana emoji (18px) + text block
  - Title: "[Name] was a rotten banana!" — 13px, weight 500, danger text
  - Subtitle: "Eliminated at MM:SS" — 11px, danger text, 0.7 opacity
- This banner auto-dismisses after ~5 seconds or stays until next action

**Main content (vertically centred):**

1. **Timer:** MM:SS format — 56px, weight 500, tabular-nums
   - Normal state: primary text colour
   - Paused state: warning/amber text colour

2. **Player chips row** (24px below timer): horizontal flex-wrap row, 8px gap, centred
   - Each chip: 22px avatar + name (12px), `border-radius: 99px`, secondary background
   - Guest chips: additional dashed border on the pill
   - Eliminated chips: danger background tint, `text-decoration: line-through`, `opacity: 0.6`

3. **BANANAS! button** (24px below chips):
   - 130×130px circle, background `#F5C842`, `box-shadow: 0 2px 0 #D4A820`
   - Text "BANA-NAS!" — 18px, weight 500, `#4A3800`, centred, line-break after "BANA-"
   - Below button: "Someone finished? Tap to check" — 11px, tertiary

---

### 3.7 Timer — checking state (Bananas! called)

**Trigger:** Someone taps the BANANAS! button.

**Header:** Same as active, but trailing pill changes to amber "Paused" with 8px amber dot.

**Main content:**
1. **Timer:** Same MM:SS but in warning/amber colour (paused)
2. **Who called it:** "[Name] called Bananas!" — 14px, weight 500, 4px margin-bottom
3. **Subtitle:** "How do you want to check?" — 13px, secondary

4. **Check options** (column, 8px gap, full width with 8px horizontal padding):
   - **"Scan their board"** — full-width button, info-blue background, info-blue text, `border: 0.5px solid` info-blue border
   - **Quick buttons row** — 2 buttons side by side, 8px gap:
     - "Valid" — success background, success text, success border, flex: 1
     - "Rotten" — danger background, danger text, danger border, flex: 1
   - **Helper:** "Use quick buttons if you've already checked visually" — 11px, tertiary, centred, 2px margin-top

**In room mode:** non-host devices show instead: "Checking [Name]'s board..." with a loading indicator, no buttons.

---

### 3.8 Board submission dashboard (room games, host view)

**Trigger:** Game ends (valid Bananas! or last player standing).

**Header bar:** "Game complete" (16px, weight 500) on left, final time "MM:SS" (13px, secondary, tabular-nums) on right.

**Winner banner** (full-width, success background):
- 40px avatar + text block: "[Name] won!" (15px, weight 500, success text) / "Top banana" (12px, success text, 0.7 opacity)
- For `last_standing` outcome: text says "[Name] is the last banana standing!"

**Board submissions section:**
- Section label: "Board submissions" — 13px, secondary, 12px margin-bottom
- Per-player rows:

  **Submitted player:**
  - Avatar + name + subtitle "N words, all valid" (or "N words, X invalid") in success/danger colour
  - Trailing: checkmark icon (success) + "View" button (12px, `padding: 3px 8px`, tertiary border, `border-radius: 8px`)

  **Eliminated player:**
  - `opacity: 0.7`, avatar uses rotten red colours
  - Subtitle: "Eliminated — N invalid words" in danger colour
  - Trailing: X icon (danger) + "View" button

  **Guest (pending):**
  - Dashed avatar, name in secondary colour
  - Subtitle: "Guest — needs host scan" in tertiary
  - Trailing: "Scan" button (info-blue background, info-blue text, 12px, weight 500, `padding: 5px 12px`, `border-radius: 8px`)

**Progress indicator** (16px margin-top):
- Card: secondary background, `border-radius: 8px`, `padding: 12px`, centred
- Text: "N of M boards submitted" — 13px, secondary
- Progress bar: 4px height, tertiary background track, info-blue fill, `border-radius: 2px`, 8px margin-top

**Footer:**
- "Finalise game" primary button — disabled (tertiary text, secondary background) until host decides they have enough boards
- When ready, turns into active primary button

---

### 3.9 Profile tab

**Purpose:** User identity, stats at a glance, friends management, guest management, and settings navigation.

**Profile header** (top, `padding: 24px 20px 20px`):
- Row: 64px avatar (user's colour) → 16px gap → text block → "Edit" button (trailing)
- Text block:
  - Name: 20px, weight 500
  - Username: "@username" — 13px, secondary colour, 2px margin-top
  - Auth provider note: star icon (12px) + "Signed in with Google" — 11px, tertiary, 2px margin-top
- Edit button: `padding: 6px 12px`, `border: 0.5px solid` secondary border, `border-radius: 8px`, 12px text, secondary colour

**Stats grid** (`padding: 0 20px 20px`, 4-column grid, 8px gap):
| Card    | Number colour | Label   |
|---------|---------------|---------|
| Games   | primary       | "Games" |
| Wins    | success green | "Wins"  |
| Rotten  | danger red    | "Rotten"|
| Win rate| primary       | "Win rate" (shows as "N%") |

Each card: metric card style per §1.2.

**Divider:** 0.5px solid tertiary, `margin: 0 20px`

**Friends section** (`padding: 16px 20px 8px`):
- Header row: "Friends (N)" (15px, weight 500) on left, "Add friend" (13px, info-blue, weight 500, tappable) on right
- Friend list rows (max 3 shown, then "See all friends" link):
  - 36px avatar (solid, their colour) + 12px gap + text block + chevron-right icon (trailing)
  - Title: name — 14px, weight 500
  - Subtitle: "@username · N games together" — 11px, tertiary
  - Online friend variant: subtitle shows "Online now" in success green colour, plus online indicator dot on avatar
- "See all friends" link: centred, 13px, info-blue, `padding: 10px 0`

**Divider:** same as above

**Guests section** (`padding: 16px 20px 8px`):
- Header row: "Your guests (N)" (15px, weight 500) on left, "Add guest" (13px, info-blue, weight 500, tappable) on right
- Description: "People you track scores for who don't have the app" — 12px, tertiary, 12px margin-bottom
- Guest list rows:
  - 36px dashed-border avatar + 12px gap + text block + "Guest" pill (trailing)
  - Title: name — 14px, weight 500, secondary colour
  - Subtitle: "N games · N wins" — 11px, tertiary
  - Trailing pill: "Guest" — 11px, `padding: 3px 8px`, `border-radius: 99px`, secondary background, tertiary text

**Divider:** same as above

**Settings links** (`padding: 12px 20px 24px`):
- Each link is a row: 18px icon (secondary colour) + 12px gap + label (14px, flex: 1) + chevron-right icon (14px, tertiary)
- `padding: 12px 0`, `border-bottom: 0.5px solid` tertiary (except last)
- Links:
  1. Clock icon → "Game history"
  2. Gear/sun icon → "Settings"
  3. Logout icon (danger colour) → "Sign out" (danger text colour) — no border-bottom, no chevron

---

### 3.10 Add friend modal (bottom sheet)

**Trigger:** "Add friend" on profile tab.

**Content:**

1. **Title:** "Add friend" — 16px, weight 500, 16px margin-bottom

2. **Search input:** Full width, 14px font
   - Left icon: 16px search/magnifying-glass icon, tertiary colour, `left: 12px`
   - Input: `padding: 10px 12px 10px 36px` (left padding for icon), `border: 0.5px solid` secondary, `border-radius: 8px`
   - Placeholder: "Search by username"

3. **Search results** (16px below input, in a bordered container: `border: 0.5px solid` tertiary, `border-radius: 8px`):
   - Each result is a row: 36px avatar + 12px gap + text block + trailing action
   - Text: name (14px, weight 500) + username (11px, tertiary)
   - **Can add:** trailing "Add" button — info-blue background, info-blue text, 12px, weight 500, `padding: 5px 12px`, `border-radius: 8px`
   - **Already added:** trailing text "Already added" — 11px, tertiary. Row at `opacity: 0.6`.
   - **Pending (request sent):** trailing text "Pending" — 11px, tertiary
   - Rows separated by `border-top: 0.5px solid` tertiary

4. **Helper:** "Friends can join your game rooms quickly" — 11px, tertiary, centred, 12px margin-top

**Empty state (no results for query):** "No users found for '@query'" — 13px, secondary, centred in results area.

---

### 3.11 Add guest modal (bottom sheet)

**Trigger:** "Add guest" on profile tab or in lobby.

**Content:**

1. **Title:** "Add a guest" — 16px, weight 500
2. **Subtitle:** "Track scores for someone who doesn't have the app" — 13px, secondary, 20px margin-bottom

3. **Name input:**
   - Label: "Name" — 12px, secondary, 6px margin-bottom
   - Input: full width, 14px, `padding: 10px 12px`, secondary border, `border-radius: 8px`
   - Placeholder: "e.g. Mum, Dad, Dave"

4. **Avatar colour picker** (16px margin-top):
   - Label: "Avatar colour" — 12px, secondary, 8px margin-bottom
   - Row of 7 colour circles, 32px each, 8px gap
   - Selected colour has `border: 2px solid` primary text colour
   - Colours: Blue, Green, Coral, Purple, Pink, Amber, Gray (see §1.1 palette)

5. **Preview card** (20px margin-top):
   - `padding: 12px`, secondary background, `border-radius: 8px`
   - 40px dashed-border avatar (selected colour) + 12px gap + text block
   - Name (14px, weight 500, secondary colour) + "Guest · managed by you" (11px, tertiary)

6. **Create button** (20px margin-top): "Create guest" — primary button style (banana yellow)
7. **Helper:** "You'll scan their boards and manage their stats" — 11px, tertiary, centred, 12px margin-top

---

### 3.12 Friend profile (push screen)

**Trigger:** Tap a friend row from profile tab or "See all friends" list.

**Header bar:** Back chevron + "Friend" title (16px, weight 500) + trailing 3-dot menu icon (options: remove friend)

**Profile section** (centred, `padding: 24px 20px`):
- 72px avatar (their colour), centred
- Name: 20px, weight 500, 12px margin-top
- Username: "@username" — 13px, secondary, 2px margin-top
- Overall stats row (16px margin-top): "N games · N wins · N% win rate" — 13px, secondary, dot-separated, centred

**Head-to-head section** (`padding: 0 20px 20px`):
- Label: "Head to head · N games" — 13px, tertiary, centred, 12px margin-bottom
- **Rivalry bar:**
  - Row: your score (left) + bar + their score (right)
  - Each score: number (22px, weight 500) + label "You"/"[Name]" (10px, tertiary) — stacked vertically, 48px wide
  - Bar: flex: 1, 8px height, `border-radius: 4px`, overflow hidden
    - Your portion: your avatar colour, width = `(yourWins / totalGames) * 100%`, left-rounded
    - Their portion: their avatar colour, remaining width, right-rounded
  - Your wins number: success green. Their wins number: danger red.

- **Fun stat cards** (16px margin-top): 2-column grid, 8px gap
  - Each card: secondary background, `border-radius: 8px`, `padding: 12px`, centred
  - Number: 16px, weight 500
  - Label: 11px, tertiary, 2px margin-top
  - Card 1: "Their rotten bananas" (count)
  - Card 2: "Fastest game together" (MM:SS time)

**Divider:** 0.5px solid, `margin: 8px 0 16px`

**Recent games together:**
- Section header: "Recent games together" — 13px, weight 500, 10px margin-bottom
- Game rows:
  - Date (11px, tertiary, 48px fixed width) + result text
  - Result: "You won" (weight 500, success) or "[Name] won" (weight 500, danger) + " · MM:SS · N players" (tertiary)
  - Rows: `padding: 8px 0`, `border-bottom: 0.5px solid` tertiary

**Footer** (sticky bottom, `padding: 12px 20px 28px`):
- Row: 2 buttons, 8px gap
  - "Invite to game" — flex: 1, primary button (banana yellow)
  - "Remove" — fixed width, `border: 0.5px solid` danger border, danger text, `border-radius: 12px`, `padding: 12px 16px`

---

### 3.13 Guest detail (push screen)

**Trigger:** Tap a guest row from profile tab.

**Header bar:** Back chevron + "Guest" title + trailing 3-dot menu (edit name/colour, delete guest)

**Profile section** (centred):
- 72px dashed-border avatar (guest's colour), centred
- Name: 20px, weight 500
- "Guest · managed by you" — 13px, secondary, 2px margin-top

**Stats grid:** Same 4-column pattern as profile tab but for this guest's stats: Games, Wins, Losses, Win rate.

**Game history for this guest:** List of games this guest has participated in, same format as friend profile's "Recent games together".

**Footer:**
- "Edit guest" secondary button (full width)
- "Delete guest" — danger text link, centred, below button

---

## 4. Data model

### 4.1 Authentication

Users sign in with Google (Firebase Auth with Google provider). Username (`@handle`) is set during onboarding after first Google sign-in.

**Username requirements:**
- 3-20 characters, lowercase alphanumeric + underscores
- Must be unique — stored in a `usernames/{username}` doc with `uid` field for reverse lookup
- Displayed with `@` prefix everywhere in UI

### 4.2 Firestore collections

```ts
// ─── Users ───

interface UserProfile {
  uid: string;
  displayName: string;
  username: string;               // unique, lowercase, no @
  email: string;
  avatarColor: string;            // hex from palette
  stats: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    rottenBananas: number;
  };
  friends: string[];              // array of friend UIDs
  createdAt: Timestamp;
}
// Path: users/{uid}

// Reverse username lookup
// Path: usernames/{username} → { uid: string }

// ─── Guests ───

interface GuestProfile {
  id: string;                     // auto-generated
  displayName: string;
  avatarColor: string;
  stats: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    rottenBananas: number;
  };
  createdAt: Timestamp;
}
// Path: users/{uid}/guests/{guestId}

// ─── Game Sessions ───

interface GameSession {
  id: string;
  hostUid: string;
  joinCode: string;               // 6-char uppercase alphanumeric
  status: 'lobby' | 'active' | 'checking' | 'ended';
  mode: 'room' | 'local';

  players: PlayerSlot[];

  timer: {
    startedAt: Timestamp | null;
    pausedAt: Timestamp | null;
    elapsed: number;              // accumulated ms excluding pauses
  };

  eliminations: Elimination[];
  winnerId: string | null;
  outcome: 'bananas' | 'last_standing' | null;

  createdAt: Timestamp;
  endedAt: Timestamp | null;
}
// Path: gameSessions/{sessionId}

interface PlayerSlot {
  type: 'authenticated' | 'guest';
  uid: string;                    // Firebase UID or guest_{nanoid}
  displayName: string;
  avatarColor: string;
  status: 'active' | 'eliminated' | 'winner';
}

interface Elimination {
  playerId: string;
  eliminatedAt: number;           // elapsed ms at elimination
  boardId?: string;
  reason: 'rotten';
}

// Board subcollection
// Path: gameSessions/{sessionId}/boards/{playerId}
// Uses existing StoredBoard type from db/queries.firestore.ts

// ─── Existing types (unchanged) ───
// Player, Game, StoredBoard — as defined in db/queries.firestore.ts
```

### 4.3 Join code generation

```ts
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
```

Uniqueness: Before writing the session doc, query `gameSessions` where `joinCode == code && status in ['lobby', 'active', 'checking']`. If match found, regenerate.

---

## 5. Game flow state machine

```
                    ┌──────────────────────────┐
                    │                          │
                    ▼                          │
IDLE ──SPLIT──► MODE_PICKER                   │
                 │       │                     │
           create room  local                  │
                 │       │                     │
                 ▼       │                     │
              LOBBY      │                     │
                 │       │                     │
            start game   │                     │
                 │       │                     │
                 ▼       ▼                     │
              PLAYING (timer running)          │
                 │                             │
            BANANAS! pressed                   │
                 │                             │
                 ▼                             │
              CHECKING (timer paused)          │
                 │              │              │
              valid          rotten            │
                 │              │              │
                 ▼              ▼              │
              ENDED      eliminate player      │
                 │         │                   │
                 │    remaining > 0?           │
                 │      yes │    no            │
                 │         │    │              │
                 │         │    ▼              │
                 │         │  ENDED            │
                 │         │  (last_standing)  │
                 │         │                   │
                 │         └───────────────────┘
                 │              (back to PLAYING)
                 ▼
         BOARD_SUBMISSION (room mode)
                 │
          finalise game
                 │
                 ▼
              SAVED → return to IDLE
```

### Timer logic

```ts
// State
let elapsed = 0;        // ms accumulated
let startedAt: number;  // Date.now() when started/resumed
let pausedAt: number;   // Date.now() when paused

// Start
startedAt = Date.now();

// Display (every frame)
const display = elapsed + (Date.now() - startedAt);

// Pause (BANANAS! called)
pausedAt = Date.now();
elapsed += (pausedAt - startedAt);
// display freezes at `elapsed`

// Resume (rotten banana)
startedAt = Date.now();
// display resumes from `elapsed + (Date.now() - startedAt)`

// End (valid win or last standing)
const finalTime = elapsed; // already accumulated when paused
```

---

## 6. File map

### New files

| File | Purpose |
|---|---|
| `app/(tabs)/profile.tsx` | Profile tab: identity, stats, friends, guests, settings links |
| `app/profile/friend/[uid].tsx` | Friend profile: head-to-head stats, recent games, invite/remove |
| `app/profile/guest/[id].tsx` | Guest detail: stats, game history, edit/delete |
| `app/auth/onboarding.tsx` | Post-Google-sign-in: set username + avatar colour |
| `components/GameModePickerModal.tsx` | Bottom sheet: "Create room" / "Local game" / "Join a room" |
| `components/JoinGameModal.tsx` | Bottom sheet: 6-character code input |
| `components/LobbyScreen.tsx` | Room code display, player list, add guest, start game |
| `components/AddFriendModal.tsx` | Bottom sheet: username search, add button |
| `components/AddGuestModal.tsx` | Bottom sheet: name input, colour picker, create |
| `components/BoardSubmissionDashboard.tsx` | Post-game host view: per-player board status |
| `components/PlayerChips.tsx` | Reusable: horizontal row of player avatar pills for timer screen |
| `components/EliminationBanner.tsx` | Dismissible rotten banana alert bar |
| `components/RivalryBar.tsx` | Reusable: head-to-head wins bar for friend profile |
| `components/AvatarCircle.tsx` | Reusable: renders solid (authenticated) or dashed (guest) avatar with initials and colour |
| `db/queries.firestore.ts` | Extended: session CRUD, user profiles, guest subcollection, friend operations, username lookup |

### Modified files

| File | Change |
|---|---|
| `app/(tabs)/split.tsx` | SPLIT button now opens GameModePickerModal instead of starting timer directly. Timer screen adds player chips, BANANAS! checking flow, elimination state. |
| `app/(tabs)/stats.tsx` | No structural changes, but game rows now show room code if applicable |
| `app/(tabs)/_layout.tsx` | Add third tab (Profile) to the tab bar |
| `components/SaveGameModal.tsx` | Add `mode: 'save' \| 'check'` prop. In check mode, return validity result without full save flow. |
| `db/queries.firestore.ts` | Add all new types and queries per §4.2 |

---

## 7. Firestore security rules

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User profiles
    match /users/{uid} {
      allow read: if request.auth != null;
      allow create: if request.auth.uid == uid;
      allow update: if request.auth.uid == uid;

      // Guests subcollection
      match /guests/{guestId} {
        allow read, write: if request.auth.uid == uid;
      }
    }

    // Username reverse lookup
    match /usernames/{username} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.uid == request.auth.uid;
      allow delete: if request.auth.uid == resource.data.uid;
    }

    // Game sessions
    match /gameSessions/{sessionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;

      // Host can update session state
      allow update: if request.auth.uid == resource.data.hostUid;

      // Players can update to add themselves (join)
      allow update: if request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['players']);

      // Board subcollection
      match /boards/{playerId} {
        allow write: if request.auth.uid == playerId
          || request.auth.uid == get(/databases/$(database)/documents/gameSessions/$(sessionId)).data.hostUid;
        allow read: if request.auth != null;
      }
    }

    // Existing collections (players, games) — keep existing rules
  }
}
```

---

## 8. Implementation order

### Phase 1: Auth + profile foundation
1. Google sign-in integration (replace or extend existing anonymous auth)
2. Post-sign-in onboarding screen (set username + avatar colour)
3. `users/{uid}` and `usernames/{username}` Firestore structure
4. AvatarCircle component (solid vs dashed, all sizes)
5. Profile tab: identity header, stats grid, settings links, sign out
6. Guest subcollection: add guest modal, guest list on profile, guest detail screen

### Phase 2: Friends
1. Add friend modal: username search against `usernames` collection
2. Friends array on user doc: add/remove operations
3. Friends list on profile tab (max 3 + "See all")
4. Friend profile screen: head-to-head stats, rivalry bar, recent games together

### Phase 3: Game mode picker + local flow
1. GameModePickerModal (bottom sheet from SPLIT button)
2. "Local game" path: starts timer immediately (existing behaviour, just routed through picker)
3. Rotten banana checking flow: BANANAS! button → checking overlay → valid/rotten → resume or end
4. Elimination state: player chips with strikethrough, elimination banner, auto-end logic

### Phase 4: Room flow
1. "Create room" path: generate join code, write `gameSession` doc, show lobby
2. JoinGameModal: 6-char code input, join session
3. LobbyScreen: real-time player list via `onSnapshot`, host controls
4. Room timer: synced via Firestore `timer` fields, all devices show same state
5. Multi-device BANANAS! check: any player triggers, host confirms

### Phase 5: Multi-device board entry
1. Post-game state: authenticated players see "Scan your board" on their device
2. Board writes to `gameSessions/{id}/boards/{playerId}` subcollection
3. Guest boards: host scans on their behalf, selects guest from dropdown
4. BoardSubmissionDashboard: per-player status, progress bar, finalise button
5. Finalise: copy boards + game record to permanent `games` collection for stats
