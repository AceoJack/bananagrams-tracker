import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase";
import { SaveGameModal } from "../../components/SaveGameModal";
import { CelebrationOverlay } from "../../components/CelebrationOverlay";
import { PlayerMultiSelect } from "../../components/PlayerMultiSelect";
import { FadeInView } from "../../components/FadeInView";
import { AvatarCircle } from "../../components/AvatarCircle";
import { formatDuration } from "../../utils/format";
import { C } from "../../utils/designSystem";
import { unlockAudio } from "../../utils/sound";
import {
  getOrCreateUserProfile,
  listGuests,
  createGuest,
  createGameFromSlots,
  addPlayerBoard,
  createGameSession,
  getSessionByCode,
  joinGameSession,
  addSlotToSession,
  removeSlotFromSession,
  startSession,
  endSession,
  pauseSessionForChecking,
  resumeSessionAfterChecking,
  closeSession,
  updateSessionBoardUpload,
  subscribeToSession,
} from "../../db/queries.firestore";
import type {
  Elimination,
  Guest,
  GameSession,
  PlayerSlot,
  StoredBoard,
  UserProfile,
} from "../../db/queries.firestore";
import * as Haptics from "expo-haptics";

// ── Types ─────────────────────────────────────────────────────────────────────

type GamePhase = "setup" | "lobby" | "playing" | "checking" | "ended" | "board_uploads";
type SetupStep = "mode" | "local";
type CheckSubMode = "pick" | "options" | "manual";
type BoardUploadStatus = "pending" | "uploaded" | "skipped";

interface EliminationRecord {
  playerUid: string;
  playerName: string;
  eliminatedAt: number;
}

interface PendingLastStanding {
  winnerUid: string;
  winnerName: string;
  eliminations: EliminationRecord[];
  finalMs: number;
}

// ── Bottom sheet wrapper ──────────────────────────────────────────────────────

function BottomSheet({
  visible, onClose, children,
}: {
  visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{
          backgroundColor: C.surface,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12,
        }}>
          {/* Drag handle */}
          <View style={{
            width: 36, height: 4, borderRadius: 2,
            backgroundColor: C.borderTertiary,
            alignSelf: "center", marginBottom: 20,
          }} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── 6-cell code input ─────────────────────────────────────────────────────────

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<TextInput>(null);
  const cells = Array(6).fill("");
  for (let i = 0; i < value.length; i++) cells[i] = value[i];

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
        {cells.map((char, i) => {
          const isActive = i === value.length;
          const isFilled = i < value.length;
          return (
            <View
              key={i}
              style={{
                width: 44, height: 56, borderRadius: C.radiusSm,
                borderWidth: isActive ? 2 : 0.5,
                borderColor: isActive ? C.info : isFilled ? C.border : C.borderTertiary,
                backgroundColor: isActive ? C.infoBg : C.surface,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{
                fontSize: 24, fontWeight: "500",
                fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
                color: C.textPrimary,
              }}>
                {char}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        autoFocus
      />
    </Pressable>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SplitScreen() {

  // ── Auth / profile / guests ───────────────────────────────────────────────
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [myGuests, setMyGuests] = useState<Guest[]>([]);

  // ── Setup modals ──────────────────────────────────────────────────────────
  const [gameModePickerOpen, setGameModePickerOpen] = useState(false);
  const [joinGameOpen, setJoinGameOpen] = useState(false);

  // ── Setup phase ───────────────────────────────────────────────────────────
  const [setupStep, setSetupStep] = useState<SetupStep>("mode");
  const [gameMode, setGameMode] = useState<"local" | "room">("local");
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<PlayerSlot[]>([]);
  const [addGuestOpen, setAddGuestOpen] = useState(false);

  // ── Join flow ─────────────────────────────────────────────────────────────
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // ── Session (room mode) ───────────────────────────────────────────────────
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const [addingGuestToSession, setAddingGuestToSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // ── Game state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<GamePhase>("setup");
  const [gamePlayers, setGamePlayers] = useState<PlayerSlot[]>([]);
  const [eliminations, setEliminations] = useState<EliminationRecord[]>([]);
  const [playedAtISO, setPlayedAtISO] = useState("");

  // ── Timer ─────────────────────────────────────────────────────────────────
  const accMsRef    = useRef(0);
  const segStartRef = useRef<number | null>(null);
  const [displayedSec, setDisplayedSec] = useState(0);

  // ── Checking phase ────────────────────────────────────────────────────────
  const [checkingPlayerUid, setCheckingPlayerUid] = useState<string | null>(null);
  const [checkSubMode, setCheckSubMode] = useState<CheckSubMode>("pick");
  const [checkBoardOpen, setCheckBoardOpen] = useState(false);

  // ── Elimination banner ────────────────────────────────────────────────────
  const [eliminationBanner, setEliminationBanner] = useState<{
    playerName: string; eliminatedAt: number;
  } | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Last-standing upload ──────────────────────────────────────────────────
  const [pendingLastStanding, setPendingLastStanding] = useState<PendingLastStanding | null>(null);
  const [uploadBoardOpen, setUploadBoardOpen] = useState(false);

  // ── Celebration ───────────────────────────────────────────────────────────
  const [celebration, setCelebration] = useState<{ type: "bananas" | "rotten"; playerName?: string } | null>(null);
  const [queuedCelebration, setQueuedCelebration] = useState<{ type: "bananas"; playerName?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Board uploads (post-game) ─────────────────────────────────────────────
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  const [roomClosed, setRoomClosed] = useState(false);
  const [boardUploadStatus, setBoardUploadStatus] = useState<Record<string, BoardUploadStatus>>({});
  const [boardUploadingUid, setBoardUploadingUid] = useState<string | null>(null);
  // Boards scanned during the rotten-banana check phase, keyed by player uid
  const [eliminatedBoards, setEliminatedBoards] = useState<Record<string, StoredBoard>>({});

  // ── Phase ref (avoids stale closures in subscribeToSession callbacks) ────────
  const phaseRef = useRef<GamePhase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Button animation ──────────────────────────────────────────────────────
  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(btnScale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  // ── Derived ───────────────────────────────────────────────────────────────
  const activePlayers   = gamePlayers.filter((p) => !eliminations.some((e) => e.playerUid === p.uid));
  const checkingPlayer  = gamePlayers.find((p) => p.uid === checkingPlayerUid) ?? null;
  const isHost          = myProfile != null && activeSession?.hostUid === myProfile.uid;

  // ── Load profile + guests on focus ───────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const auth = getFirebaseAuth();
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        try {
          const [profile, guests] = await Promise.all([
            getOrCreateUserProfile({
              uid: user.uid, displayName: user.displayName,
              email: user.email, photoURL: user.photoURL,
            }),
            listGuests(user.uid),
          ]);
          setMyProfile(profile);
          setMyGuests(guests);
        } catch (e) {
          console.warn("[SplitScreen] failed to load profile/guests:", e);
        }
      });
      return () => unsub();
    }, [])
  );

  useEffect(() => { return () => { sessionUnsubRef.current?.(); }; }, []);

  // ── Timer interval ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      if (segStartRef.current !== null) {
        setDisplayedSec(Math.floor((accMsRef.current + Date.now() - segStartRef.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  // ── Timer helpers ─────────────────────────────────────────────────────────
  const pauseTimer  = () => {
    if (segStartRef.current !== null) {
      accMsRef.current += Date.now() - segStartRef.current;
      segStartRef.current = null;
    }
  };
  const resumeTimer = () => { segStartRef.current = Date.now(); };
  const snapshotElapsedMs = () =>
    accMsRef.current + (segStartRef.current !== null ? Date.now() - segStartRef.current : 0);

  // ── Elimination banner helpers ────────────────────────────────────────────
  const showEliminationBanner = (playerName: string, eliminatedAt: number) => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setEliminationBanner({ playerName, eliminatedAt });
    bannerTimerRef.current = setTimeout(() => setEliminationBanner(null), 5000);
  };

  // ── Slot toggle (local setup) ─────────────────────────────────────────────
  const toggleSlot = (slot: PlayerSlot) => {
    setSelectedUids((prev) =>
      prev.includes(slot.uid) ? prev.filter((id) => id !== slot.uid) : [...prev, slot.uid]
    );
    setSelectedSlots((prev) => {
      const exists = prev.some((s) => s.uid === slot.uid);
      return exists ? prev.filter((s) => s.uid !== slot.uid) : [...prev, slot];
    });
  };

  // ── Create guest ──────────────────────────────────────────────────────────
  const handleCreateGuest = async (name: string) => {
    if (!myProfile) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const guest = await createGuest(myProfile.uid, name);
    setMyGuests((prev) => [...prev, guest].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleAddGuestToSession = async (name: string) => {
    if (!myProfile || !activeSession) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSessionError(null);
    const guest = await createGuest(myProfile.uid, name);
    setMyGuests((prev) => [...prev, guest].sort((a, b) => a.name.localeCompare(b.name)));
    const slot: PlayerSlot = {
      type: "guest", uid: guest.id,
      ownerUid: myProfile.uid, ownerDisplayName: myProfile.displayName,
      displayName: guest.name, status: "active",
    };
    try {
      await addSlotToSession(activeSession.id, slot);
    } catch (e: any) {
      setSessionError(e?.message ?? "Could not add guest.");
    }
  };

  const handleAddExistingGuestToSession = async (guest: Guest) => {
    if (!myProfile || !activeSession) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSessionError(null);
    const slot: PlayerSlot = {
      type: "guest", uid: guest.id,
      ownerUid: myProfile.uid, ownerDisplayName: myProfile.displayName,
      displayName: guest.name, status: "active",
    };
    try {
      await addSlotToSession(activeSession.id, slot);
    } catch (e: any) {
      setSessionError(e?.message ?? "Could not add guest.");
    }
  };

  // ── Start local game ──────────────────────────────────────────────────────
  const handleStartLocal = async () => {
    if (selectedSlots.length === 0) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setGamePlayers(selectedSlots);
    setEliminations([]);
    setPlayedAtISO(new Date().toISOString());
    setSaveError(null);
    accMsRef.current = 0;
    segStartRef.current = Date.now();
    setDisplayedSec(0);
    setPhase("playing");
  };

  // ── Create / join room ────────────────────────────────────────────────────
  const handleCreateRoom = async () => {
    if (!myProfile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGameModePickerOpen(false);
    try {
      const session = await createGameSession(myProfile);
      setActiveSession(session);
      sessionUnsubRef.current?.();
      sessionUnsubRef.current = subscribeToSession(session.id, (s) => {
        if (!s) return;
        setActiveSession(s);
        // Another device pressed BANANAS! while host was in playing phase
        if (s.status === "checking" && phaseRef.current === "playing") {
          pauseTimer();
          accMsRef.current = s.timer.elapsed;
          setCheckingPlayerUid(s.checkingPlayerId);
          setCheckSubMode("options");
          setPhase("checking");
        }
        // Check resolved as rotten on another device — resume
        if (s.status === "active" && phaseRef.current === "checking") {
          accMsRef.current = s.timer.elapsed;
          resumeTimer();
          setCheckingPlayerUid(null);
          setCheckSubMode("pick");
          setPhase("playing");
        }
        // Game ended on another device — go to board uploads
        if (s.status === "ended" && (phaseRef.current === "playing" || phaseRef.current === "checking")) {
          pauseTimer();
          setGamePlayers(s.players);
          const sessionElims: EliminationRecord[] = (s.eliminations ?? []).map((e) => ({
            playerUid: e.playerId,
            playerName: s.players.find((p) => p.uid === e.playerId)?.displayName ?? "Player",
            eliminatedAt: e.eliminatedAt,
          }));
          setEliminations(sessionElims);
          if (s.gameId) {
            setSavedGameId(s.gameId);
            const status: Record<string, BoardUploadStatus> = {};
            for (const p of s.players) status[p.uid] = "pending";
            setBoardUploadStatus({ ...status, ...s.boardUploads });
            setPhase("board_uploads");
          }
        }
        // Sync board upload statuses from other devices
        if (phaseRef.current === "board_uploads" && Object.keys(s.boardUploads).length > 0) {
          setBoardUploadStatus((prev) => ({ ...prev, ...s.boardUploads }));
        }
      });
      setGameMode("room");
      setPhase("lobby");
    } catch (e: any) {
      console.warn("createRoom failed:", e);
    }
  };

  const handleJoinRoom = async () => {
    if (!myProfile || !joinCodeInput.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const session = await getSessionByCode(joinCodeInput.trim());
      if (!session) { setJoinError("Room not found. Check the code and try again."); return; }
      const mySlot: PlayerSlot = {
        type: "user", uid: myProfile.uid,
        ownerUid: null, ownerDisplayName: null,
        displayName: myProfile.displayName, status: "active",
      };
      await joinGameSession(session.id, mySlot);
      setActiveSession(session);
      sessionUnsubRef.current?.();
      sessionUnsubRef.current = subscribeToSession(session.id, (s) => {
        if (!s) return;
        setActiveSession(s);
        // Host started the game
        if (s.status === "active" && phaseRef.current === "lobby") {
          setGamePlayers(s.players);
          setEliminations([]);
          setPlayedAtISO(new Date().toISOString());
          setSaveError(null);
          accMsRef.current = 0;
          segStartRef.current = Date.now();
          setDisplayedSec(0);
          setPhase("playing");
        }
        // Someone pressed BANANAS! — pause timer and show waiting screen
        if (s.status === "checking" && phaseRef.current === "playing") {
          pauseTimer();
          accMsRef.current = s.timer.elapsed;
          setCheckingPlayerUid(s.checkingPlayerId);
          setCheckSubMode("options");
          setPhase("checking");
        }
        // Check resolved as rotten — resume
        if (s.status === "active" && phaseRef.current === "checking") {
          accMsRef.current = s.timer.elapsed;
          resumeTimer();
          setCheckingPlayerUid(null);
          setCheckSubMode("pick");
          setPhase("playing");
        }
        // Game ended — go to board upload screen
        if (s.status === "ended" && (phaseRef.current === "playing" || phaseRef.current === "checking")) {
          pauseTimer();
          // Sync players and eliminations from the session snapshot
          setGamePlayers(s.players);
          const sessionElims: EliminationRecord[] = (s.eliminations ?? []).map((e) => ({
            playerUid: e.playerId,
            playerName: s.players.find((p) => p.uid === e.playerId)?.displayName ?? "Player",
            eliminatedAt: e.eliminatedAt,
          }));
          setEliminations(sessionElims);
          if (s.gameId) {
            setSavedGameId(s.gameId);
            const status: Record<string, BoardUploadStatus> = {};
            for (const p of s.players) status[p.uid] = "pending";
            setBoardUploadStatus({ ...status, ...s.boardUploads });
            setPhase("board_uploads");
          }
        }
        // Host closed the session after board uploads
        if (s.status === "closed" && phaseRef.current === "board_uploads") {
          setRoomClosed(true);
        }
        // Sync board upload statuses from other devices
        if (phaseRef.current === "board_uploads" && Object.keys(s.boardUploads).length > 0) {
          setBoardUploadStatus((prev) => ({ ...prev, ...s.boardUploads }));
        }
      });
      setGameMode("room");
      setJoinGameOpen(false);
      setPhase("lobby");
    } catch (e: any) {
      setJoinError(e?.message ?? "Failed to join room.");
    } finally {
      setJoining(false);
    }
  };

  // ── Start room game (host) ────────────────────────────────────────────────
  const handleStartRoom = async () => {
    if (!activeSession || !isHost) return;
    if (activeSession.players.length < 2) { setSessionError("Need at least 2 players to start."); return; }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await startSession(activeSession.id);
      setGamePlayers(activeSession.players);
      setEliminations([]);
      setPlayedAtISO(new Date().toISOString());
      setSaveError(null);
      accMsRef.current = 0;
      segStartRef.current = Date.now();
      setDisplayedSec(0);
      setPhase("playing");
    } catch (e: any) {
      setSessionError(e?.message ?? "Could not start game.");
    }
  };

  const handleRemoveFromLobby = async (uid: string) => {
    if (!activeSession || !isHost) return;
    try { await removeSlotFromSession(activeSession.id, uid); }
    catch (e: any) { setSessionError(e?.message ?? "Could not remove player."); }
  };

  const handleLeaveRoom = () => {
    sessionUnsubRef.current?.();
    sessionUnsubRef.current = null;
    setActiveSession(null);
    resetToSetup();
  };

  // ── BANANAS press ─────────────────────────────────────────────────────────
  const handleBananas = async () => {
    unlockAudio();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    pauseTimer();
    if (gameMode === "room" && activeSession && myProfile) {
      // In room mode, the player pressing BANANAS! is the caller — skip the pick step
      setCheckingPlayerUid(myProfile.uid);
      setCheckSubMode("options");
      setPhase("checking");
      await pauseSessionForChecking(activeSession.id, myProfile.uid, accMsRef.current).catch(() => {});
    } else {
      setCheckingPlayerUid(null);
      setCheckSubMode("pick");
      setPhase("checking");
    }
  };

  const handleCancelChecking = () => {
    setCheckingPlayerUid(null);
    setCheckSubMode("pick");
    resumeTimer();
    setPhase("playing");
    if (gameMode === "room" && activeSession) {
      resumeSessionAfterChecking(activeSession.id, accMsRef.current).catch(() => {});
    }
  };

  const handleSelectCheckingPlayer = (uid: string) => {
    setCheckingPlayerUid(uid);
    setCheckSubMode("options");
  };

  // ── Check result ──────────────────────────────────────────────────────────
  const handleCheckResult = async (valid: boolean, board: StoredBoard | null) => {
    unlockAudio();
    if (valid) {
      await saveGame(checkingPlayerUid!, "bananas", board, eliminations);
    } else {
      const playerName = checkingPlayer?.displayName ?? "Player";
      const newElim: EliminationRecord = {
        playerUid: checkingPlayerUid!,
        playerName,
        eliminatedAt: accMsRef.current,
      };
      const newElims = [...eliminations, newElim];
      // Preserve board scanned during the check so we can save it after game is created
      if (board) {
        setEliminatedBoards((prev) => ({ ...prev, [checkingPlayerUid!]: board }));
      }
      setEliminations(newElims);
      setCheckingPlayerUid(null);
      setCheckSubMode("pick");

      const remaining = gamePlayers.filter((p) => !newElims.some((e) => e.playerUid === p.uid));

      if (remaining.length <= 1) {
        if (remaining.length === 1) {
          const winner = remaining[0];
          setPendingLastStanding({
            winnerUid: winner.uid, winnerName: winner.displayName,
            eliminations: newElims, finalMs: accMsRef.current,
          });
          setPhase("ended");
          setQueuedCelebration({ type: "bananas", playerName: winner.displayName });
          setCelebration({ type: "rotten", playerName });
        } else {
          resetToSetup();
        }
      } else {
        setPhase("playing");
        resumeTimer();
        if (gameMode === "room" && activeSession) {
          resumeSessionAfterChecking(activeSession.id, accMsRef.current).catch(() => {});
        }
        showEliminationBanner(playerName, accMsRef.current);
        setCelebration({ type: "rotten", playerName });
      }
    }
  };

  // ── Save game ─────────────────────────────────────────────────────────────
  const initBoardUploadStatus = (
    players: PlayerSlot[],
    winnerUid: string,
    winnerBoard: StoredBoard | null,
    scannedElimBoards: Record<string, StoredBoard> = {},
  ): Record<string, BoardUploadStatus> => {
    const status: Record<string, BoardUploadStatus> = {};
    for (const p of players) {
      if (p.uid === winnerUid && winnerBoard) status[p.uid] = "uploaded";
      else if (scannedElimBoards[p.uid]) status[p.uid] = "uploaded";
      else status[p.uid] = "pending";
    }
    return status;
  };

  const saveGame = async (
    winnerUid: string,
    outcome: "bananas" | "last_standing",
    board: StoredBoard | null,
    currentElims: EliminationRecord[],
    rottenPlayerName?: string,
  ) => {
    const finalMs = snapshotElapsedMs();
    setPhase("ended");
    setSaving(true);
    try {
      const elimsPayload: Elimination[] = currentElims.map((e) => ({
        playerId: e.playerUid, eliminatedAt: e.eliminatedAt, reason: "rotten" as const,
      }));
      const gameId = await createGameFromSlots({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        slots: gamePlayers, winnerId: winnerUid,
        board: board ?? undefined,
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome,
      });
      setSavedGameId(gameId);
      const uploadStatus = initBoardUploadStatus(gamePlayers, winnerUid, board, eliminatedBoards);
      setBoardUploadStatus(uploadStatus);
      // Save any boards that were scanned during the rotten check phase
      await Promise.all(
        Object.entries(eliminatedBoards).map(([uid, b]) => addPlayerBoard(gameId, uid, b).catch(() => {}))
      );
      if (activeSession && gameMode === "room") {
        const sessionUploads = Object.fromEntries(
          Object.entries(uploadStatus).filter(([, v]) => v !== "pending")
        ) as Record<string, "uploaded" | "skipped">;
        await endSession(activeSession.id, winnerUid, outcome, finalMs, elimsPayload, gameId, sessionUploads).catch(() => {});
      }
      const winnerName = gamePlayers.find((p) => p.uid === winnerUid)?.displayName;
      if (rottenPlayerName) {
        setQueuedCelebration({ type: "bananas", playerName: winnerName });
        setCelebration({ type: "rotten", playerName: rottenPlayerName });
      } else {
        setCelebration({ type: "bananas", playerName: winnerName });
      }
    } catch (e: any) {
      setSaveError(e?.message ?? "Could not save game");
      setPhase("ended");
    } finally {
      setSaving(false);
    }
  };

  // ── Complete last-standing save ───────────────────────────────────────────
  const completePendingSave = async (board?: StoredBoard) => {
    if (!pendingLastStanding) return;
    const { winnerUid, eliminations: elims, finalMs } = pendingLastStanding;
    setSaving(true);
    setSaveError(null);
    try {
      const elimsPayload: Elimination[] = elims.map((e) => ({
        playerId: e.playerUid, eliminatedAt: e.eliminatedAt, reason: "rotten" as const,
      }));
      const gameId = await createGameFromSlots({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        slots: gamePlayers, winnerId: winnerUid,
        ...(board ? { board } : {}),
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome: "last_standing",
      });
      setSavedGameId(gameId);
      const status = initBoardUploadStatus(gamePlayers, winnerUid, board ?? null, eliminatedBoards);
      setBoardUploadStatus(status);
      if (activeSession && gameMode === "room") {
        const sessionUploads = Object.fromEntries(
          Object.entries(status).filter(([, v]) => v !== "pending")
        ) as Record<string, "uploaded" | "skipped">;
        await endSession(activeSession.id, winnerUid, "last_standing", finalMs, elimsPayload, gameId, sessionUploads).catch(() => {});
      }
      // Save any boards that were scanned during the rotten check phase
      await Promise.all(
        Object.entries(eliminatedBoards).map(([uid, b]) => addPlayerBoard(gameId, uid, b).catch(() => {}))
      );
      setPendingLastStanding(null);
      const hasPending = Object.values(status).some((s) => s === "pending");
      if (hasPending) { setPhase("board_uploads"); } else { resetToSetup(); }
    } catch (e: any) {
      setSaveError(e?.message ?? "Could not save game");
    } finally {
      setSaving(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetToSetup = () => {
    accMsRef.current = 0;
    segStartRef.current = null;
    setDisplayedSec(0);
    setPhase("setup");
    setSetupStep("mode");
    setGameMode("local");
    setGamePlayers([]);
    setEliminations([]);
    setSelectedUids([]);
    setSelectedSlots([]);
    setCheckingPlayerUid(null);
    setCheckSubMode("pick");
    setCheckBoardOpen(false);
    setPendingLastStanding(null);
    setUploadBoardOpen(false);
    setSaveError(null);
    setCelebration(null);
    setQueuedCelebration(null);
    setSavedGameId(null);
    setBoardUploadStatus({});
    setBoardUploadingUid(null);
    setEliminatedBoards({});
    setRoomClosed(false);
    setJoinCodeInput("");
    setJoinError(null);
    setSessionError(null);
    setEliminationBanner(null);
    sessionUnsubRef.current?.();
    sessionUnsubRef.current = null;
    setActiveSession(null);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ── RENDER ──────────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  // ── Idle screen ───────────────────────────────────────────────────────────
  if (phase === "setup" && setupStep === "mode") {
    return (
      <FadeInView>
        <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center", padding: 24, gap: 0 }}>

          {/* Timer display */}
          <Text style={{
            fontSize: 64, fontWeight: "500", color: C.textPrimary,
            fontVariant: ["tabular-nums"], letterSpacing: -2, lineHeight: 72,
          }}>
            00:00
          </Text>
          <Text style={{ fontSize: 13, color: C.textTertiary, marginTop: 4, marginBottom: 32 }}>
            Tap SPLIT to start a game
          </Text>

          {/* Circle SPLIT button */}
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={() => setGameModePickerOpen(true)}
              onPressIn={pressIn}
              onPressOut={pressOut}
              style={{
                width: 160, height: 160, borderRadius: 80,
                backgroundColor: C.brand,
                alignItems: "center", justifyContent: "center",
                shadowColor: C.brandShadow,
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 1, shadowRadius: 0,
                elevation: 4,
              }}
            >
              <Text style={{
                fontSize: 28, fontWeight: "500",
                color: C.brandText, letterSpacing: 2,
              }}>
                SPLIT!
              </Text>
            </Pressable>
          </Animated.View>

          {/* Join room link */}
          <Pressable
            onPress={() => setJoinGameOpen(true)}
            style={{
              marginTop: 32, flexDirection: "row", alignItems: "center", gap: 8,
              paddingVertical: 12, paddingHorizontal: 20,
              borderWidth: 0.5, borderColor: C.border,
              borderRadius: C.radiusMd,
            }}
          >
            <Text style={{ fontSize: 18, color: C.textSecondary, lineHeight: 20 }}>+</Text>
            <Text style={{ fontSize: 14, color: C.textSecondary }}>Join a game room</Text>
          </Pressable>
        </View>

        {/* ── Game mode picker bottom sheet ── */}
        <BottomSheet visible={gameModePickerOpen} onClose={() => setGameModePickerOpen(false)}>
          <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary }}>Start a game</Text>
          <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 20 }}>
            Choose how you want to play
          </Text>

          {/* Create room option */}
          <Pressable
            onPress={handleCreateRoom}
            style={({ pressed }) => ({
              borderWidth: 0.5, borderColor: C.borderTertiary,
              borderRadius: C.radiusMd, padding: 16, marginBottom: 12,
              flexDirection: "row", alignItems: "center", gap: 14,
              backgroundColor: pressed ? C.surfaceSecondary : C.surface,
            })}
          >
            <View style={{
              width: 44, height: 44, borderRadius: C.radiusMd,
              backgroundColor: C.infoBg, alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 20 }}>🌐</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: C.textPrimary }}>Create room</Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 2 }}>
                Share a code so friends can join from their own phones and scan their own boards
              </Text>
            </View>
            <Text style={{ fontSize: 18, color: C.textTertiary }}>›</Text>
          </Pressable>

          {/* Local game option */}
          <Pressable
            onPress={() => { setGameMode("local"); setGameModePickerOpen(false); setSetupStep("local"); }}
            style={({ pressed }) => ({
              borderWidth: 0.5, borderColor: C.borderTertiary,
              borderRadius: C.radiusMd, padding: 16,
              flexDirection: "row", alignItems: "center", gap: 14,
              backgroundColor: pressed ? C.surfaceSecondary : C.surface,
            })}
          >
            <View style={{
              width: 44, height: 44, borderRadius: C.radiusMd,
              backgroundColor: C.warningBg, alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 20 }}>📱</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: C.textPrimary }}>Local game</Text>
              <Text style={{ fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 2 }}>
                Timer on this device only. Enter everyone's boards yourself after the game
              </Text>
            </View>
            <Text style={{ fontSize: 18, color: C.textTertiary }}>›</Text>
          </Pressable>

          {/* Join link */}
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <Pressable onPress={() => { setGameModePickerOpen(false); setJoinGameOpen(true); }}>
              <Text style={{ fontSize: 13, color: C.textSecondary }}>
                Have a code?{" "}
                <Text style={{ color: C.info, fontWeight: "500" }}>Join a room</Text>
              </Text>
            </Pressable>
          </View>
        </BottomSheet>

        {/* ── Join game bottom sheet ── */}
        <BottomSheet visible={joinGameOpen} onClose={() => { setJoinGameOpen(false); setJoinCodeInput(""); setJoinError(null); }}>
          <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary }}>Join a game</Text>
          <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 24 }}>
            Enter the room code from the host's screen
          </Text>

          <CodeInput value={joinCodeInput} onChange={setJoinCodeInput} />

          {joinError && (
            <Text style={{ color: C.danger, fontSize: 13, textAlign: "center", marginTop: 12 }}>
              {joinError}
            </Text>
          )}

          <Pressable
            onPress={handleJoinRoom}
            disabled={joining || joinCodeInput.length < 6}
            style={{
              marginTop: 24,
              padding: 14, borderRadius: C.radiusMd, alignItems: "center",
              backgroundColor: joinCodeInput.length < 6 ? C.surfaceSecondary : C.brand,
            }}
          >
            <Text style={{
              fontSize: 15, fontWeight: "500",
              color: joinCodeInput.length < 6 ? C.textTertiary : C.brandText,
            }}>
              {joining ? "Joining…" : "Join game"}
            </Text>
          </Pressable>

          <Text style={{ fontSize: 11, color: C.textTertiary, textAlign: "center", marginTop: 12 }}>
            You'll join once the host starts the game
          </Text>
        </BottomSheet>
      </FadeInView>
    );
  }

  // ── Local player select ───────────────────────────────────────────────────
  if (phase === "setup" && setupStep === "local") {
    return (
      <FadeInView>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: C.bg }}
        >
          <Pressable onPress={() => setSetupStep("mode")} style={{ alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 15, color: C.textSecondary, fontWeight: "500" }}>← Back</Text>
          </Pressable>

          <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary }}>Select players</Text>

          {myProfile ? (
            <PlayerMultiSelect
              me={myProfile}
              guests={myGuests}
              selectedUids={selectedUids}
              onToggle={toggleSlot}
            />
          ) : (
            <Text style={{ color: C.textTertiary, fontStyle: "italic" }}>Loading…</Text>
          )}

          <Pressable onPress={() => setAddGuestOpen(true)} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
            <Text style={{ fontSize: 14, color: C.info }}>+ Add guest</Text>
          </Pressable>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={handleStartLocal}
              onPressIn={pressIn}
              onPressOut={pressOut}
              disabled={selectedSlots.length === 0}
              style={{
                padding: 14, borderRadius: C.radiusMd, alignItems: "center",
                backgroundColor: selectedSlots.length === 0 ? C.surfaceSecondary : C.brand,
                shadowColor: selectedSlots.length === 0 ? "transparent" : C.brandShadow,
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: selectedSlots.length === 0 ? 0 : 1,
                shadowRadius: 0, elevation: selectedSlots.length === 0 ? 0 : 4,
              }}
            >
              <Text style={{
                fontSize: 16, fontWeight: "500",
                color: selectedSlots.length === 0 ? C.textTertiary : C.brandText,
              }}>
                SPLIT
              </Text>
            </Pressable>
          </Animated.View>
        </ScrollView>

        {/* Add guest sheet */}
        <BottomSheet visible={addGuestOpen} onClose={() => setAddGuestOpen(false)}>
          <AddGuestSheetContent
            onClose={() => setAddGuestOpen(false)}
            onCreate={async (name) => { await handleCreateGuest(name); setAddGuestOpen(false); }}
          />
        </BottomSheet>
      </FadeInView>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────
  if (phase === "lobby" && activeSession) {
    const sessionGuestUids = new Set(activeSession.players.filter((p) => p.type === "guest").map((g) => g.uid));
    const availableGuests  = myGuests.filter((g) => !sessionGuestUids.has(g.id));

    return (
      <FadeInView>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} style={{ backgroundColor: C.bg }}>

          {/* Header */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
            backgroundColor: C.surface,
            borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
          }}>
            <Pressable onPress={handleLeaveRoom}>
              <Text style={{ fontSize: 20, color: C.textSecondary }}>‹</Text>
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: "500", color: C.textPrimary }}>Game lobby</Text>
            {isHost ? (
              <View style={{
                backgroundColor: C.successBg, borderRadius: C.radiusFull,
                paddingHorizontal: 10, paddingVertical: 3,
              }}>
                <Text style={{ fontSize: 12, color: C.successText, fontWeight: "500" }}>Host</Text>
              </View>
            ) : (
              <View style={{ width: 48 }} />
            )}
          </View>

          {/* Room code hero */}
          <View style={{
            backgroundColor: C.surfaceSecondary,
            paddingVertical: 24, paddingHorizontal: 20,
            alignItems: "center", gap: 8,
          }}>
            <Text style={{
              fontSize: 12, color: C.textSecondary, letterSpacing: 1.5,
              textTransform: "uppercase", fontWeight: "500",
            }}>
              Room Code
            </Text>
            <Text style={{
              fontSize: 48, fontWeight: "500", letterSpacing: 8,
              fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
              color: C.textPrimary,
            }}>
              {activeSession.joinCode}
            </Text>
            {isHost && Platform.OS === "web" && (
              <Pressable
                onPress={() => navigator.clipboard?.writeText(activeSession.joinCode)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 6,
                  borderWidth: 0.5, borderColor: C.border, borderRadius: C.radiusSm,
                  flexDirection: "row", alignItems: "center", gap: 6,
                }}
              >
                <Text style={{ fontSize: 13, color: C.textSecondary }}>Copy</Text>
              </Pressable>
            )}
          </View>

          {/* Player list */}
          <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
            {sessionError && (
              <Text style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{sessionError}</Text>
            )}

            <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
              Players ({activeSession.players.length})
            </Text>

            {activeSession.players.map((p) => {
              const isGuest = p.type === "guest";
              const isMe = p.uid === myProfile?.uid;
              return (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    paddingVertical: 10,
                    borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
                  }}
                >
                  <AvatarCircle uid={p.uid} displayName={p.displayName} size={36} guest={isGuest} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                      {p.displayName}
                    </Text>
                    <Text style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>
                      {p.uid === activeSession.hostUid ? "Host" : isGuest ? "Guest" : isMe ? "You" : "Joined"}
                    </Text>
                  </View>
                  {isHost && p.uid !== myProfile?.uid && (
                    <Pressable onPress={() => handleRemoveFromLobby(p.uid)} style={{ padding: 8 }}>
                      <Text style={{ color: C.textTertiary, fontSize: 16 }}>✕</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

            {/* Available guests to add */}
            {isHost && availableGuests.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => handleAddExistingGuestToSession(g)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
                  opacity: 0.6,
                }}
              >
                <AvatarCircle uid={g.id} displayName={g.name} size={36} guest />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: C.textSecondary }}>
                    {g.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Tap to add</Text>
                </View>
                <Text style={{ fontSize: 18, color: C.info }}>+</Text>
              </Pressable>
            ))}

            {/* Add guest row */}
            {isHost && (
              <Pressable
                onPress={() => setAddingGuestToSession(true)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 12,
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  borderWidth: 1, borderStyle: "dashed", borderColor: C.info,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 18, color: C.info, lineHeight: 22 }}>+</Text>
                </View>
                <Text style={{ fontSize: 14, color: C.info }}>Add guest</Text>
              </Pressable>
            )}
          </View>

          {/* Footer */}
          <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
            {isHost ? (
              <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                <Pressable
                  onPress={handleStartRoom}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={activeSession.players.length < 2}
                  style={{
                    padding: 14, borderRadius: C.radiusMd, alignItems: "center",
                    backgroundColor: activeSession.players.length < 2 ? C.surfaceSecondary : C.brand,
                    shadowColor: C.brandShadow, shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: activeSession.players.length < 2 ? 0 : 1,
                    shadowRadius: 0, elevation: activeSession.players.length < 2 ? 0 : 4,
                  }}
                >
                  <Text style={{
                    fontSize: 16, fontWeight: "500",
                    color: activeSession.players.length < 2 ? C.textTertiary : C.brandText,
                  }}>
                    Start game ({activeSession.players.length} player{activeSession.players.length !== 1 ? "s" : ""})
                  </Text>
                </Pressable>
              </Animated.View>
            ) : (
              <Text style={{ fontSize: 14, color: C.textSecondary, textAlign: "center", padding: 14 }}>
                Waiting for host to start…
              </Text>
            )}

            <Pressable onPress={handleLeaveRoom} style={{ alignSelf: "center", padding: 12, marginTop: 8 }}>
              <Text style={{ color: C.danger, fontSize: 14, fontWeight: "500" }}>Leave room</Text>
            </Pressable>
          </View>
        </ScrollView>

        <BottomSheet visible={addingGuestToSession} onClose={() => setAddingGuestToSession(false)}>
          <AddGuestSheetContent
            onClose={() => setAddingGuestToSession(false)}
            onCreate={async (name) => { await handleAddGuestToSession(name); setAddingGuestToSession(false); }}
          />
        </BottomSheet>
      </FadeInView>
    );
  }

  // ── Board uploads (post-game) ─────────────────────────────────────────────
  if (phase === "board_uploads" && savedGameId) {
    // For room games, use the authoritative winnerId from the session.
    // For local games, derive it from eliminations.
    const winnerUid = (gameMode === "room" && activeSession?.winnerId)
      ? activeSession.winnerId
      : gamePlayers.find((p) => !eliminations.some((e) => e.playerUid === p.uid))?.uid ?? null;

    return (
      <FadeInView>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}
          style={{ backgroundColor: C.bg }}
        >
          <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary }}>Upload boards</Text>
          <Text style={{ fontSize: 13, color: C.textSecondary }}>
            Optional — scan your board to track your tiles and words over time.
          </Text>

          <View style={{ gap: 0 }}>
            {gamePlayers.map((p) => {
              const status  = boardUploadStatus[p.uid] ?? "pending";
              const isWinner = p.uid === winnerUid;
              const isElim   = eliminations.some((e) => e.playerUid === p.uid);
              return (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
                  }}
                >
                  <AvatarCircle uid={p.uid} displayName={p.displayName} size={36} guest={p.type === "guest"} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                        {p.displayName}
                      </Text>
                      {isWinner && (
                        <Text style={{ fontSize: 11, color: C.success, fontWeight: "500" }}>Winner</Text>
                      )}
                      {isElim && (
                        <Text style={{ fontSize: 11, color: C.danger, fontWeight: "500" }}>Rotten 🍌</Text>
                      )}
                    </View>
                  </View>
                  {status === "uploaded" ? (
                    <Text style={{ fontSize: 13, color: C.success, fontWeight: "500" }}>✓ Scanned</Text>
                  ) : status === "skipped" ? (
                    <Text style={{ fontSize: 13, color: C.textTertiary }}>Skipped</Text>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => setBoardUploadingUid(p.uid)}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6,
                          borderRadius: C.radiusSm, backgroundColor: C.textPrimary,
                        }}
                      >
                        <Text style={{ color: C.surface, fontWeight: "500", fontSize: 13 }}>Scan</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setBoardUploadStatus((prev) => ({ ...prev, [p.uid]: "skipped" }));
                          if (gameMode === "room" && activeSession) {
                            updateSessionBoardUpload(activeSession.id, p.uid, "skipped").catch(() => {});
                          }
                        }}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6,
                          borderRadius: C.radiusSm,
                          borderWidth: 0.5, borderColor: C.border,
                        }}
                      >
                        <Text style={{ color: C.textSecondary, fontWeight: "500", fontSize: 13 }}>Skip</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={async () => {
              if (gameMode === "room" && activeSession && isHost) {
                await closeSession(activeSession.id).catch(() => {});
              }
              resetToSetup();
            }}
            style={{
              padding: 14, borderRadius: C.radiusMd, alignItems: "center",
              backgroundColor: C.brand,
              shadowColor: C.brandShadow, shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 1, shadowRadius: 0, elevation: 4,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "500", color: C.brandText }}>Done</Text>
          </Pressable>
        </ScrollView>

        <SaveGameModal
          visible={boardUploadingUid !== null}
          mode="upload"
          onClose={() => setBoardUploadingUid(null)}
          durationSeconds={displayedSec}
          playedAtISO={playedAtISO}
          onSaved={() => {}}
          onCheckResult={async ({ board }) => {
            if (board && boardUploadingUid && savedGameId) {
              await addPlayerBoard(savedGameId, boardUploadingUid, board).catch(() => {});
              setBoardUploadStatus((prev) => ({ ...prev, [boardUploadingUid]: "uploaded" }));
              if (gameMode === "room" && activeSession) {
                updateSessionBoardUpload(activeSession.id, boardUploadingUid, "uploaded").catch(() => {});
              }
            }
            setBoardUploadingUid(null);
          }}
        />
      </FadeInView>
    );
  }

  // ── Timer screen (playing / checking / ended) ─────────────────────────────
  return (
    <FadeInView>
      <View style={{ flex: 1, backgroundColor: C.bg }}>

        {/* Header bar */}
        <View style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12,
          backgroundColor: C.surface,
          borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
        }}>
          <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
            {gameMode === "room" && activeSession
              ? `Room: ${activeSession.joinCode}`
              : "Local game"}
          </Text>
          {phase === "checking" ? (
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: C.warningBg, borderRadius: C.radiusFull,
              paddingHorizontal: 10, paddingVertical: 4,
            }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.warning }} />
              <Text style={{ fontSize: 12, color: C.warningText, fontWeight: "500" }}>Paused</Text>
            </View>
          ) : (
            <View style={{
              backgroundColor: C.successBg, borderRadius: C.radiusFull,
              paddingHorizontal: 10, paddingVertical: 4,
            }}>
              <Text style={{ fontSize: 12, color: C.successText, fontWeight: "500" }}>
                {gamePlayers.length} player{gamePlayers.length !== 1 ? "s" : ""}
              </Text>
            </View>
          )}
        </View>

        {/* Elimination banner */}
        {eliminationBanner && (
          <View style={{
            backgroundColor: C.dangerBg, paddingHorizontal: 20, paddingVertical: 10,
            flexDirection: "row", alignItems: "center", gap: 10,
          }}>
            <Text style={{ fontSize: 18 }}>🍌</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: C.danger }}>
                {eliminationBanner.playerName} was a rotten banana!
              </Text>
              <Text style={{ fontSize: 11, color: C.danger, opacity: 0.7, marginTop: 1 }}>
                Eliminated at {formatDuration(Math.floor(eliminationBanner.eliminatedAt / 1000))}
              </Text>
            </View>
            <Pressable onPress={() => setEliminationBanner(null)}>
              <Text style={{ color: C.danger, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Main content — vertically centred */}
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 0 }}>

          {/* Timer */}
          <Text style={{
            fontSize: 56, fontWeight: "500", letterSpacing: -2,
            fontVariant: ["tabular-nums"],
            color: phase === "checking" ? C.warning : C.textPrimary,
            lineHeight: 64,
          }}>
            {formatDuration(displayedSec)}
          </Text>

          {/* Player chips */}
          {gamePlayers.length > 0 && (
            <View style={{
              flexDirection: "row", flexWrap: "wrap", gap: 8,
              justifyContent: "center", marginTop: 24,
            }}>
              {gamePlayers.map((p) => {
                const elim = eliminations.find((e) => e.playerUid === p.uid);
                const isGuest = p.type === "guest";
                return (
                  <View
                    key={p.uid}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 6,
                      paddingVertical: 5, paddingHorizontal: 10,
                      borderRadius: C.radiusFull,
                      backgroundColor: elim ? C.dangerBg + "55" : C.surfaceSecondary,
                      borderWidth: isGuest ? 0.5 : 0,
                      borderStyle: isGuest ? "dashed" : "solid",
                      borderColor: isGuest ? C.border : "transparent",
                      opacity: elim ? 0.6 : 1,
                    }}
                  >
                    <AvatarCircle uid={p.uid} displayName={p.displayName} size={22} guest={isGuest} />
                    <Text style={{
                      fontSize: 12, color: elim ? C.danger : C.textPrimary,
                      textDecorationLine: elim ? "line-through" : "none",
                    }}>
                      {p.displayName}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* BANANAS! button */}
          {phase === "playing" && (
            <View style={{ marginTop: 24, alignItems: "center", gap: 10 }}>
              <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                <Pressable
                  onPress={handleBananas}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  style={{
                    width: 130, height: 130, borderRadius: 65,
                    backgroundColor: C.brand, alignItems: "center", justifyContent: "center",
                    shadowColor: C.brandShadow, shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 1, shadowRadius: 0, elevation: 4,
                  }}
                >
                  <Text style={{
                    fontSize: 18, fontWeight: "500",
                    color: C.brandText, textAlign: "center", lineHeight: 24,
                  }}>
                    {"BANA-\nNAS!"}
                  </Text>
                </Pressable>
              </Animated.View>
              <Text style={{ fontSize: 11, color: C.textTertiary }}>
                Someone finished? Tap to check
              </Text>
            </View>
          )}

          {saving && !pendingLastStanding && (
            <Text style={{ textAlign: "center", color: C.textTertiary, marginTop: 16 }}>Saving…</Text>
          )}
          {saveError && !pendingLastStanding && (
            <Text style={{ textAlign: "center", color: C.danger, marginTop: 16 }}>{saveError}</Text>
          )}

          {/* Last-standing board upload prompt */}
          {phase === "ended" && pendingLastStanding && !celebration && (
            <View style={{
              width: "100%", borderRadius: C.radiusLg,
              borderWidth: 0.5, borderColor: C.borderTertiary,
              backgroundColor: C.surface, padding: 20, gap: 14,
              marginTop: 24,
            }}>
              <Text style={{ fontSize: 16, fontWeight: "500", textAlign: "center", color: C.textPrimary }}>
                {pendingLastStanding.winnerName}, scan your board?
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setUploadBoardOpen(true)}
                  style={{
                    flex: 1, padding: 14, borderRadius: C.radiusMd,
                    backgroundColor: C.textPrimary, alignItems: "center",
                  }}
                >
                  <Text style={{ color: C.surface, fontWeight: "500" }}>Scan board</Text>
                </Pressable>
                <Pressable
                  onPress={() => completePendingSave()}
                  disabled={saving}
                  style={{
                    flex: 1, padding: 14, borderRadius: C.radiusMd,
                    borderWidth: 0.5, borderColor: C.border, alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "500", color: C.textSecondary }}>
                    {saving ? "Saving…" : "Skip"}
                  </Text>
                </Pressable>
              </View>
              {saveError && (
                <Text style={{ textAlign: "center", color: C.danger, fontSize: 13 }}>{saveError}</Text>
              )}
            </View>
          )}

          {!(phase === "ended" && pendingLastStanding && !celebration) && (
            <Pressable onPress={resetToSetup} style={{ marginTop: 24, padding: 8 }}>
              <Text style={{ color: C.textTertiary, fontSize: 13 }}>
                {phase === "ended" ? "New game" : "Reset"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Checking overlay ──────────────────────────────────────────────────── */}
      <Modal visible={phase === "checking"} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "flex-end",
        }}>
          <View style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: 24, paddingBottom: 40, gap: 16,
          }}>
            {/* Drag handle */}
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: C.borderTertiary, alignSelf: "center",
            }} />

            {/* Waiting view — shown to everyone except the player who called Bananas! */}
            {gameMode === "room" && checkingPlayerUid !== myProfile?.uid && (
              <View style={{ alignItems: "center", gap: 16, paddingVertical: 16 }}>
                <ActivityIndicator size="large" color={C.brand} />
                <Text style={{ fontSize: 16, fontWeight: "500", color: C.textPrimary, textAlign: "center" }}>
                  {checkingPlayer
                    ? `${checkingPlayer.displayName} called Bananas!`
                    : "Bananas! called"}
                </Text>
                <Text style={{ fontSize: 13, color: C.textSecondary, textAlign: "center" }}>
                  {checkingPlayer
                    ? `Waiting for ${checkingPlayer.displayName} to confirm their board…`
                    : "Waiting for the player to confirm…"}
                </Text>
              </View>
            )}

            {(gameMode !== "room" || checkingPlayerUid === myProfile?.uid) && checkSubMode === "pick" && (
              <>
                <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary, textAlign: "center" }}>
                  Who called Bananas?
                </Text>
                <View style={{ gap: 8 }}>
                  {activePlayers.map((p) => (
                    <Pressable
                      key={p.uid}
                      onPress={() => handleSelectCheckingPlayer(p.uid)}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", gap: 12,
                        padding: 14, borderRadius: C.radiusMd,
                        backgroundColor: pressed ? C.surfaceSecondary : C.brand,
                      })}
                    >
                      <AvatarCircle uid={p.uid} displayName={p.displayName} size={32} guest={p.type === "guest"} />
                      <Text style={{ fontWeight: "500", fontSize: 16, color: C.brandText }}>{p.displayName}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={handleCancelChecking} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: C.textTertiary, fontSize: 14 }}>Cancel (resume timer)</Text>
                </Pressable>
              </>
            )}

            {(gameMode !== "room" || checkingPlayerUid === myProfile?.uid) && checkSubMode === "options" && checkingPlayer && (
              <>
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary, textAlign: "center" }}>
                    {checkingPlayer.displayName} called Bananas!
                  </Text>
                  <Text style={{ fontSize: 13, color: C.textSecondary, textAlign: "center" }}>
                    How do you want to check?
                  </Text>
                </View>

                <Pressable
                  onPress={() => setCheckBoardOpen(true)}
                  style={({ pressed }) => ({
                    padding: 14, borderRadius: C.radiusMd, alignItems: "center",
                    backgroundColor: pressed ? C.infoBg : C.infoBg,
                    borderWidth: 0.5, borderColor: C.info,
                  })}
                >
                  <Text style={{ color: C.info, fontWeight: "500", fontSize: 16 }}>Scan your board</Text>
                </Pressable>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => handleCheckResult(true, null)}
                    style={({ pressed }) => ({
                      flex: 1, padding: 14, borderRadius: C.radiusMd, alignItems: "center",
                      backgroundColor: C.successBg, borderWidth: 0.5, borderColor: C.success,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ fontWeight: "500", fontSize: 15, color: C.successText }}>✓ Valid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCheckSubMode("manual")}
                    style={({ pressed }) => ({
                      flex: 1, padding: 14, borderRadius: C.radiusMd, alignItems: "center",
                      backgroundColor: C.dangerBg, borderWidth: 0.5, borderColor: C.dangerBorder,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ fontWeight: "500", fontSize: 15, color: C.danger }}>✗ Rotten</Text>
                  </Pressable>
                </View>

                <Text style={{ fontSize: 11, color: C.textTertiary, textAlign: "center" }}>
                  Use quick buttons if you've already checked visually
                </Text>

                <Pressable onPress={() => setCheckSubMode("pick")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: C.textTertiary, fontSize: 13 }}>← Back</Text>
                </Pressable>
              </>
            )}

            {(gameMode !== "room" || checkingPlayerUid === myProfile?.uid) && checkSubMode === "manual" && checkingPlayer && (
              <>
                <Text style={{ fontSize: 16, fontWeight: "500", color: C.textPrimary, textAlign: "center" }}>
                  Is {checkingPlayer.displayName}'s board valid?
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => handleCheckResult(true, null)}
                    style={{
                      flex: 1, padding: 16, borderRadius: C.radiusMd,
                      backgroundColor: C.successBg, borderWidth: 0.5, borderColor: C.success,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "700", fontSize: 18, color: C.successText }}>✓ Valid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleCheckResult(false, null)}
                    style={{
                      flex: 1, padding: 16, borderRadius: C.radiusMd,
                      backgroundColor: C.dangerBg, borderWidth: 0.5, borderColor: C.dangerBorder,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "700", fontSize: 18, color: C.danger }}>✗ Rotten</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setCheckSubMode("options")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: C.textTertiary, fontSize: 13 }}>← Back</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Board scan modal (check) ──────────────────────────────────────────── */}
      <SaveGameModal
        visible={checkBoardOpen}
        mode="check"
        onClose={() => setCheckBoardOpen(false)}
        durationSeconds={displayedSec}
        playedAtISO={playedAtISO}
        onSaved={() => {}}
        onCheckResult={({ valid, board }) => {
          setCheckBoardOpen(false);
          handleCheckResult(valid, board);
        }}
      />

      {/* ── Board upload modal (last-standing) ───────────────────────────────── */}
      <SaveGameModal
        visible={uploadBoardOpen}
        mode="upload"
        onClose={() => setUploadBoardOpen(false)}
        durationSeconds={displayedSec}
        playedAtISO={playedAtISO}
        onSaved={() => {}}
        onCheckResult={({ board }) => {
          setUploadBoardOpen(false);
          completePendingSave(board ?? undefined);
        }}
      />

      {/* ── Celebration overlay ───────────────────────────────────────────────── */}
      {celebration && (
        <CelebrationOverlay
          key={celebration.type + (celebration.playerName ?? "")}
          type={celebration.type}
          playerName={celebration.playerName}
          onDone={() => {
            if (queuedCelebration) {
              setCelebration(queuedCelebration);
              setQueuedCelebration(null);
            } else {
              setCelebration(null);
              if (phase === "ended" && !pendingLastStanding) {
                const hasPending = Object.values(boardUploadStatus).some((s) => s === "pending");
                if (savedGameId && hasPending) {
                  setPhase("board_uploads");
                } else {
                  resetToSetup();
                }
              }
            }
          }}
        />
      )}

      {/* ── Room closed notification ──────────────────────────────────────────── */}
      <Modal visible={roomClosed} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center", alignItems: "center", padding: 32,
        }}>
          <View style={{
            backgroundColor: C.surface, borderRadius: C.radiusLg,
            padding: 28, gap: 14, width: "100%", alignItems: "center",
          }}>
            <Text style={{ fontSize: 28 }}>🍌</Text>
            <Text style={{ fontSize: 18, fontWeight: "500", color: C.textPrimary, textAlign: "center" }}>
              Room closed
            </Text>
            <Text style={{ fontSize: 14, color: C.textSecondary, textAlign: "center" }}>
              The host has ended the session.
            </Text>
            <Pressable
              onPress={() => { setRoomClosed(false); resetToSetup(); }}
              style={{
                backgroundColor: C.brand, borderRadius: C.radiusMd,
                padding: 14, width: "100%", alignItems: "center", marginTop: 4,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "500", color: C.brandText }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </FadeInView>
  );
}

// ── Inline add-guest sheet content ────────────────────────────────────────────

function AddGuestSheetContent({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onCreate(trimmed);
      setName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={{ fontSize: 16, fontWeight: "500", color: C.textPrimary }}>Add a guest</Text>
      <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 20 }}>
        Track scores for someone who doesn't have the app
      </Text>

      <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Mum, Dad, Dave"
        placeholderTextColor={C.textTertiary}
        autoCapitalize="words"
        style={{
          borderWidth: 0.5, borderColor: C.border,
          borderRadius: C.radiusSm, padding: 10, fontSize: 14,
          color: C.textPrimary,
        }}
      />

      <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
        <Pressable
          onPress={onClose}
          style={{
            flex: 1, padding: 14, borderRadius: C.radiusMd,
            borderWidth: 0.5, borderColor: C.border, alignItems: "center",
          }}
        >
          <Text style={{ color: C.textSecondary, fontWeight: "500" }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleCreate}
          disabled={saving || !name.trim()}
          style={{
            flex: 1, padding: 14, borderRadius: C.radiusMd, alignItems: "center",
            backgroundColor: !name.trim() ? C.surfaceSecondary : C.brand,
          }}
        >
          <Text style={{
            fontWeight: "500",
            color: !name.trim() ? C.textTertiary : C.brandText,
          }}>
            {saving ? "Creating…" : "Create guest"}
          </Text>
        </Pressable>
      </View>
    </>
  );
}
