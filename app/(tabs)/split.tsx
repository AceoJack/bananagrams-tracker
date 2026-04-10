import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
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
import { AddPlayerSheet } from "../../components/AddPlayerSheet";
import { PlayerMultiSelect } from "../../components/PlayerMultiSelect";
import { FadeInView } from "../../components/FadeInView";
import { formatDuration } from "../../utils/format";
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
type BoardUploadStatus = "pending" | "uploaded" | "skipped";
type SetupStep = "mode" | "local" | "join"; // sub-steps within setup phase

type CheckSubMode = "pick" | "options" | "manual";

interface EliminationRecord {
  playerUid: string;
  playerName: string;
  eliminatedAt: number; // elapsed ms
}

interface PendingLastStanding {
  winnerUid: string;
  winnerName: string;
  eliminations: EliminationRecord[];
  finalMs: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SplitScreen() {

  // ── Auth / profile / guests ───────────────────────────────────────────────
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [myGuests, setMyGuests] = useState<Guest[]>([]);

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
  const accMsRef = useRef(0);
  const segStartRef = useRef<number | null>(null);
  const [displayedSec, setDisplayedSec] = useState(0);

  // ── Checking phase ────────────────────────────────────────────────────────
  const [checkingPlayerUid, setCheckingPlayerUid] = useState<string | null>(null);
  const [checkSubMode, setCheckSubMode] = useState<CheckSubMode>("pick");
  const [checkBoardOpen, setCheckBoardOpen] = useState(false);

  // ── Last-standing upload ──────────────────────────────────────────────────
  const [pendingLastStanding, setPendingLastStanding] = useState<PendingLastStanding | null>(null);
  const [uploadBoardOpen, setUploadBoardOpen] = useState(false);

  // ── Celebration ───────────────────────────────────────────────────────────
  const [celebration, setCelebration] = useState<{ type: "bananas" | "rotten"; playerName?: string } | null>(null);
  const [queuedCelebration, setQueuedCelebration] = useState<{ type: "bananas"; playerName?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Board uploads (post-game, optional) ───────────────────────────────────
  const [savedGameId, setSavedGameId] = useState<string | null>(null);
  const [boardUploadStatus, setBoardUploadStatus] = useState<Record<string, BoardUploadStatus>>({});
  const [boardUploadingUid, setBoardUploadingUid] = useState<string | null>(null);

  // ── Button animation ──────────────────────────────────────────────────────
  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  // ── Derived ───────────────────────────────────────────────────────────────
  const activePlayers = gamePlayers.filter((p) => !eliminations.some((e) => e.playerUid === p.uid));
  const checkingPlayer = gamePlayers.find((p) => p.uid === checkingPlayerUid) ?? null;
  const isHost = myProfile != null && activeSession?.hostUid === myProfile.uid;

  // ── Load profile + guests on focus ───────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const auth = getFirebaseAuth();
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        try {
          const [profile, guests] = await Promise.all([
            getOrCreateUserProfile({
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              photoURL: user.photoURL,
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

  // Cleanup session subscription on unmount
  useEffect(() => {
    return () => { sessionUnsubRef.current?.(); };
  }, []);

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
  const pauseTimer = () => {
    if (segStartRef.current !== null) {
      accMsRef.current += Date.now() - segStartRef.current;
      segStartRef.current = null;
    }
  };

  const resumeTimer = () => { segStartRef.current = Date.now(); };

  const snapshotElapsedMs = () =>
    accMsRef.current + (segStartRef.current !== null ? Date.now() - segStartRef.current : 0);

  // ── Guest toggle (setup, local mode) ─────────────────────────────────────
  const toggleSlot = (slot: PlayerSlot) => {
    setSelectedUids((prev) =>
      prev.includes(slot.uid) ? prev.filter((id) => id !== slot.uid) : [...prev, slot.uid]
    );
    setSelectedSlots((prev) => {
      const exists = prev.some((s) => s.uid === slot.uid);
      return exists ? prev.filter((s) => s.uid !== slot.uid) : [...prev, slot];
    });
  };

  // ── Create guest (add to my list + re-fetch) ──────────────────────────────
  const handleCreateGuest = async (name: string) => {
    if (!myProfile) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const guest = await createGuest(myProfile.uid, name);
    setMyGuests((prev) => [...prev, guest].sort((a, b) => a.name.localeCompare(b.name)));
  };

  // ── Add guest to active room session ─────────────────────────────────────
  const handleAddGuestToSession = async (name: string) => {
    if (!myProfile || !activeSession) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSessionError(null);
    const guest = await createGuest(myProfile.uid, name);
    setMyGuests((prev) => [...prev, guest].sort((a, b) => a.name.localeCompare(b.name)));
    const slot: PlayerSlot = {
      type: "guest",
      uid: guest.id,
      ownerUid: myProfile.uid,
      ownerDisplayName: myProfile.displayName,
      displayName: guest.name,
      status: "active",
    };
    try {
      await addSlotToSession(activeSession.id, slot);
    } catch (e: any) {
      setSessionError(e?.message ?? "Could not add guest.");
    }
  };

  // ── Add an existing guest to the session ─────────────────────────────────
  const handleAddExistingGuestToSession = async (guest: Guest) => {
    if (!myProfile || !activeSession) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSessionError(null);
    const slot: PlayerSlot = {
      type: "guest",
      uid: guest.id,
      ownerUid: myProfile.uid,
      ownerDisplayName: myProfile.displayName,
      displayName: guest.name,
      status: "active",
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

  // ── Create room ───────────────────────────────────────────────────────────
  const handleCreateRoom = async () => {
    if (!myProfile) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const session = await createGameSession(myProfile);
      setActiveSession(session);
      // Subscribe to live updates
      sessionUnsubRef.current?.();
      sessionUnsubRef.current = subscribeToSession(session.id, (s) => {
        if (s) setActiveSession(s);
      });
      setPhase("lobby");
    } catch (e: any) {
      console.warn("createRoom failed:", e);
    }
  };

  // ── Join room by code ─────────────────────────────────────────────────────
  const handleJoinRoom = async () => {
    if (!myProfile || !joinCodeInput.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const session = await getSessionByCode(joinCodeInput.trim());
      if (!session) { setJoinError("Room not found. Check the code and try again."); return; }

      const mySlot: PlayerSlot = {
        type: "user",
        uid: myProfile.uid,
        ownerUid: null,
        ownerDisplayName: null,
        displayName: myProfile.displayName,
        status: "active",
      };
      await joinGameSession(session.id, mySlot);

      setActiveSession(session);
      sessionUnsubRef.current?.();
      sessionUnsubRef.current = subscribeToSession(session.id, (s) => {
        if (!s) return;
        setActiveSession(s);
        // Transition to playing when host starts the game
        if (s.status === "active" && phase === "lobby") {
          setGamePlayers(s.players);
          setEliminations([]);
          setPlayedAtISO(new Date().toISOString());
          setSaveError(null);
          accMsRef.current = 0;
          segStartRef.current = Date.now();
          setDisplayedSec(0);
          setPhase("playing");
        }
      });
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
      const slots = activeSession.players;
      setGamePlayers(slots);
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

  // ── Remove player from lobby (host only) ──────────────────────────────────
  const handleRemoveFromLobby = async (uid: string) => {
    if (!activeSession || !isHost) return;
    try {
      await removeSlotFromSession(activeSession.id, uid);
    } catch (e: any) {
      setSessionError(e?.message ?? "Could not remove player.");
    }
  };

  // ── Leave room ────────────────────────────────────────────────────────────
  const handleLeaveRoom = () => {
    sessionUnsubRef.current?.();
    sessionUnsubRef.current = null;
    setActiveSession(null);
    resetToSetup();
  };

  // ── BANANAS press ─────────────────────────────────────────────────────────
  const handleBananas = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    pauseTimer();
    setCheckingPlayerUid(null);
    setCheckSubMode("pick");
    setPhase("checking");
  };

  const handleCancelChecking = () => {
    setCheckingPlayerUid(null);
    setCheckSubMode("pick");
    resumeTimer();
    setPhase("playing");
  };

  const handleSelectCheckingPlayer = (uid: string) => {
    setCheckingPlayerUid(uid);
    setCheckSubMode("options");
  };

  // ── Check result ──────────────────────────────────────────────────────────
  const handleCheckResult = async (valid: boolean, board: StoredBoard | null) => {
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
      setEliminations(newElims);
      setCheckingPlayerUid(null);
      setCheckSubMode("pick");

      const remaining = gamePlayers.filter((p) => !newElims.some((e) => e.playerUid === p.uid));

      if (remaining.length <= 1) {
        if (remaining.length === 1) {
          const winner = remaining[0];
          setPendingLastStanding({
            winnerUid: winner.uid,
            winnerName: winner.displayName,
            eliminations: newElims,
            finalMs: accMsRef.current,
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
        setCelebration({ type: "rotten", playerName });
      }
    }
  };

  // ── Save game ─────────────────────────────────────────────────────────────
  const initBoardUploadStatus = (
    players: PlayerSlot[],
    winnerUid: string,
    winnerBoard: StoredBoard | null,
  ): Record<string, BoardUploadStatus> => {
    const status: Record<string, BoardUploadStatus> = {};
    for (const p of players) {
      status[p.uid] = p.uid === winnerUid && winnerBoard ? "uploaded" : "pending";
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
        playerId: e.playerUid,
        eliminatedAt: e.eliminatedAt,
        reason: "rotten" as const,
      }));

      const gameId = await createGameFromSlots({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        slots: gamePlayers,
        winnerId: winnerUid,
        board: board ?? undefined,
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome,
      });

      setSavedGameId(gameId);
      setBoardUploadStatus(initBoardUploadStatus(gamePlayers, winnerUid, board));

      // End the room session if in room mode
      if (activeSession && gameMode === "room") {
        await endSession(activeSession.id, winnerUid, outcome, finalMs, elimsPayload).catch(() => {});
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
        playerId: e.playerUid,
        eliminatedAt: e.eliminatedAt,
        reason: "rotten" as const,
      }));
      const gameId = await createGameFromSlots({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        slots: gamePlayers,
        winnerId: winnerUid,
        ...(board ? { board } : {}),
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome: "last_standing",
      });
      if (activeSession && gameMode === "room") {
        await endSession(activeSession.id, winnerUid, "last_standing", finalMs, elimsPayload).catch(() => {});
      }
      setSavedGameId(gameId);
      const status = initBoardUploadStatus(gamePlayers, winnerUid, board ?? null);
      setBoardUploadStatus(status);
      setPendingLastStanding(null);
      const hasPending = Object.values(status).some((s) => s === "pending");
      if (hasPending) {
        setPhase("board_uploads");
      } else {
        resetToSetup();
      }
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
    setJoinCodeInput("");
    setJoinError(null);
    setSessionError(null);
    sessionUnsubRef.current?.();
    sessionUnsubRef.current = null;
    setActiveSession(null);
  };

  // ── Render: Setup — mode picker ───────────────────────────────────────────
  if (phase === "setup" && setupStep === "mode") {
    return (
      <FadeInView>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 24 }}>
          <Text style={{ fontSize: 28, fontWeight: "800" }}>New Game</Text>
          <Text style={{ fontSize: 15, color: "#666" }}>How do you want to play?</Text>

          {/* Play Locally */}
          <Pressable
            onPress={() => { setGameMode("local"); setSetupStep("local"); }}
            style={({ pressed }) => ({
              padding: 20, borderRadius: 16, borderWidth: 1, borderColor: "#e0e0e0",
              backgroundColor: pressed ? "#f9f9f9" : "#fff",
              gap: 6,
              shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 }, elevation: 2,
            })}
          >
            <Text style={{ fontSize: 20, fontWeight: "800" }}>🎲 Play Locally</Text>
            <Text style={{ fontSize: 14, color: "#888" }}>
              Pick your guests and play on one device. Classic experience.
            </Text>
          </Pressable>

          {/* Create Room */}
          <Pressable
            onPress={() => { setGameMode("room"); handleCreateRoom(); }}
            style={({ pressed }) => ({
              padding: 20, borderRadius: 16, borderWidth: 1, borderColor: "#F9A825",
              backgroundColor: pressed ? "#FFF8E1" : "#FFFDE7",
              gap: 6,
              shadowColor: "#F9A825", shadowOpacity: 0.2, shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 }, elevation: 2,
            })}
          >
            <Text style={{ fontSize: 20, fontWeight: "800" }}>🍌 Create Room</Text>
            <Text style={{ fontSize: 14, color: "#888" }}>
              Get a room code. Friends join and scan their own boards.
            </Text>
          </Pressable>

          {/* Join Room */}
          <Pressable
            onPress={() => { setGameMode("room"); setSetupStep("join"); }}
            style={{ alignSelf: "center", padding: 8 }}
          >
            <Text style={{ fontSize: 15, color: "#555", fontWeight: "600" }}>
              Join a Room →
            </Text>
          </Pressable>
        </ScrollView>
      </FadeInView>
    );
  }

  // ── Render: Setup — join room by code ────────────────────────────────────
  if (phase === "setup" && setupStep === "join") {
    return (
      <FadeInView>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          <Pressable onPress={() => setSetupStep("mode")} style={{ alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 15, color: "#555", fontWeight: "600" }}>← Back</Text>
          </Pressable>
          <Text style={{ fontSize: 24, fontWeight: "800" }}>Join a Room</Text>
          <Text style={{ fontSize: 14, color: "#888" }}>
            Enter the 6-character code shown on the host's screen.
          </Text>

          <TextInput
            value={joinCodeInput}
            onChangeText={(t) => setJoinCodeInput(t.toUpperCase().slice(0, 6))}
            placeholder="E.g. BXK7Q2"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={{
              borderWidth: 2, borderColor: joinCodeInput.length === 6 ? "#F9A825" : "#ddd",
              borderRadius: 12, padding: 14, fontSize: 28, fontWeight: "800",
              letterSpacing: 6, textAlign: "center",
            }}
          />

          {joinError && <Text style={{ color: "#c00", fontSize: 13, textAlign: "center" }}>{joinError}</Text>}

          <Pressable
            onPress={handleJoinRoom}
            disabled={joining || joinCodeInput.length < 6}
            style={{
              padding: 16, borderRadius: 14,
              backgroundColor: joinCodeInput.length < 6 ? "#ddd" : "#111",
              alignItems: "center",
              opacity: joining ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "white", fontSize: 17, fontWeight: "700" }}>
              {joining ? "Joining…" : "Join Room"}
            </Text>
          </Pressable>
        </ScrollView>
      </FadeInView>
    );
  }

  // ── Render: Setup — local player select ──────────────────────────────────
  if (phase === "setup" && setupStep === "local") {
    return (
      <FadeInView>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => setSetupStep("mode")} style={{ alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 15, color: "#555", fontWeight: "600" }}>← Back</Text>
          </Pressable>
          <Text style={{ fontSize: 28, fontWeight: "800" }}>Select Players</Text>

          {myProfile ? (
            <PlayerMultiSelect
              me={myProfile}
              guests={myGuests}
              selectedUids={selectedUids}
              onToggle={toggleSlot}
            />
          ) : (
            <Text style={{ color: "#999", fontStyle: "italic" }}>Loading…</Text>
          )}

          <Pressable onPress={() => setAddGuestOpen(true)} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
            <Text style={{ fontSize: 15, color: "#555" }}>+ Add Guest</Text>
          </Pressable>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={handleStartLocal}
              onPressIn={pressIn}
              onPressOut={pressOut}
              disabled={selectedSlots.length === 0}
              style={{
                padding: 16, borderRadius: 14,
                backgroundColor: selectedSlots.length === 0 ? "#ddd" : "#FFED29",
                alignItems: "center",
                shadowColor: selectedSlots.length === 0 ? "transparent" : "#FFED29",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
              }}
            >
              <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>SPLIT</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>

        <AddPlayerSheet
          visible={addGuestOpen}
          onClose={() => setAddGuestOpen(false)}
          onCreate={async (name) => {
            await handleCreateGuest(name);
            setAddGuestOpen(false);
          }}
        />
      </FadeInView>
    );
  }

  // ── Render: Lobby ─────────────────────────────────────────────────────────
  if (phase === "lobby" && activeSession) {
    const users = activeSession.players.filter((p) => p.type === "user");
    const guests = activeSession.players.filter((p) => p.type === "guest");
    const sessionGuestUids = new Set(guests.map((g) => g.uid));
    const availableGuests = myGuests.filter((g) => !sessionGuestUids.has(g.id));

    return (
      <FadeInView>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}>
          <Text style={{ fontSize: 24, fontWeight: "800" }}>Room Lobby</Text>

          {/* Join code */}
          <View style={{
            backgroundColor: "#FFFDE7", borderRadius: 16,
            borderWidth: 2, borderColor: "#F9A825",
            padding: 20, alignItems: "center", gap: 6,
          }}>
            <Text style={{ fontSize: 13, color: "#F57F17", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 }}>
              Room Code
            </Text>
            <Text style={{ fontSize: 42, fontWeight: "900", letterSpacing: 8, color: "#1a1a1a" }}>
              {activeSession.joinCode}
            </Text>
            <Text style={{ fontSize: 12, color: "#aaa" }}>Share this code with friends</Text>
            {Platform.OS === "web" && (
              <Pressable
                onPress={() => navigator.clipboard?.writeText(activeSession.joinCode)}
                style={{ marginTop: 4, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#F9A825" }}
              >
                <Text style={{ color: "#F57F17", fontWeight: "700", fontSize: 13 }}>Copy Code</Text>
              </Pressable>
            )}
          </View>

          {sessionError && (
            <Text style={{ color: "#c00", fontSize: 13, textAlign: "center" }}>{sessionError}</Text>
          )}

          {/* Two-column player list */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            {/* Users column */}
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Players ({users.length})
              </Text>
              {users.map((p) => (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    padding: 10, borderRadius: 10,
                    backgroundColor: p.uid === activeSession.hostUid ? "#FFFDE7" : "#f9f9f9",
                    borderWidth: 1, borderColor: p.uid === activeSession.hostUid ? "#F9A825" : "#eee",
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                    {p.displayName}
                    {p.uid === activeSession.hostUid ? " 👑" : ""}
                  </Text>
                  {isHost && p.uid !== myProfile?.uid && (
                    <Pressable onPress={() => handleRemoveFromLobby(p.uid)} style={{ padding: 4 }}>
                      <Text style={{ color: "#c00", fontSize: 13 }}>✕</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>

            {/* Guests column */}
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Guests ({guests.length})
              </Text>
              {guests.length === 0 && (
                <Text style={{ fontSize: 13, color: "#ccc", fontStyle: "italic" }}>None yet</Text>
              )}
              {guests.map((p) => (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    padding: 10, borderRadius: 10,
                    backgroundColor: "#f9f9f9", borderWidth: 1, borderColor: "#eee",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{p.displayName}</Text>
                    {p.ownerDisplayName && (
                      <Text style={{ fontSize: 11, color: "#aaa" }}>{p.ownerDisplayName}'s guest</Text>
                    )}
                  </View>
                  {isHost && (
                    <Pressable onPress={() => handleRemoveFromLobby(p.uid)} style={{ padding: 4 }}>
                      <Text style={{ color: "#c00", fontSize: 13 }}>✕</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {availableGuests.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => handleAddExistingGuestToSession(g)}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    padding: 10, borderRadius: 10,
                    backgroundColor: pressed ? "#f0f0f0" : "#fafafa",
                    borderWidth: 1, borderColor: "#eee", borderStyle: "dashed",
                    opacity: 0.7,
                  })}
                >
                  <Text style={{ fontSize: 14, color: "#888" }} numberOfLines={1}>{g.name}</Text>
                  <Text style={{ fontSize: 16, color: "#aaa" }}>+</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setAddingGuestToSession(true)} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
                <Text style={{ fontSize: 13, color: "#555" }}>+ New Guest</Text>
              </Pressable>
            </View>
          </View>

          {/* Start / Leave */}
          {isHost ? (
            <Animated.View style={{ transform: [{ scale: btnScale }] }}>
              <Pressable
                onPress={handleStartRoom}
                onPressIn={pressIn}
                onPressOut={pressOut}
                disabled={activeSession.players.length < 2}
                style={{
                  padding: 16, borderRadius: 14,
                  backgroundColor: activeSession.players.length < 2 ? "#ddd" : "#FFED29",
                  alignItems: "center",
                  shadowColor: "#FFED29", shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
                }}
              >
                <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>
                  SPLIT ({activeSession.players.length} player{activeSession.players.length !== 1 ? "s" : ""})
                </Text>
              </Pressable>
            </Animated.View>
          ) : (
            <View style={{
              padding: 16, borderRadius: 14, backgroundColor: "#f9f9f9",
              borderWidth: 1, borderColor: "#eee", alignItems: "center",
            }}>
              <Text style={{ color: "#888", fontSize: 15 }}>Waiting for host to start…</Text>
            </View>
          )}

          <Pressable onPress={handleLeaveRoom} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: "#c00", fontSize: 14, fontWeight: "600" }}>Leave Room</Text>
          </Pressable>
        </ScrollView>

        <AddPlayerSheet
          visible={addingGuestToSession}
          onClose={() => setAddingGuestToSession(false)}
          onCreate={async (name) => {
            await handleAddGuestToSession(name);
            setAddingGuestToSession(false);
          }}
        />
      </FadeInView>
    );
  }

  // ── Render: Board uploads (post-game, optional) ───────────────────────────
  if (phase === "board_uploads" && savedGameId) {
    const winnerUid = gamePlayers.find((p) =>
      !eliminations.some((e) => e.playerUid === p.uid)
    )?.uid ?? null;

    return (
      <FadeInView>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}>
          <Text style={{ fontSize: 24, fontWeight: "800" }}>Upload Boards</Text>
          <Text style={{ fontSize: 14, color: "#888" }}>
            Optional — scan your board to track your tiles and words over time.
          </Text>

          <View style={{ gap: 10 }}>
            {gamePlayers.map((p) => {
              const status = boardUploadStatus[p.uid] ?? "pending";
              const isWinner = p.uid === winnerUid;
              const isElim = eliminations.some((e) => e.playerUid === p.uid);
              return (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", alignItems: "center",
                    padding: 14, borderRadius: 12,
                    backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee",
                    gap: 10,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: "#1a1a1a" }}>
                        {p.displayName}
                      </Text>
                      {isWinner && <Text style={{ fontSize: 12, color: "#F9A825", fontWeight: "700" }}>Winner</Text>}
                      {isElim && <Text style={{ fontSize: 12, color: "#c00", fontWeight: "600" }}>Rotten 🍌</Text>}
                    </View>
                  </View>
                  {status === "uploaded" ? (
                    <Text style={{ fontSize: 13, color: "#4caf50", fontWeight: "700" }}>✓ Scanned</Text>
                  ) : status === "skipped" ? (
                    <Text style={{ fontSize: 13, color: "#bbb" }}>Skipped</Text>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => setBoardUploadingUid(p.uid)}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#111" }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Scan</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setBoardUploadStatus((prev) => ({ ...prev, [p.uid]: "skipped" }))}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#f3f3f3" }}
                      >
                        <Text style={{ color: "#555", fontWeight: "600", fontSize: 13 }}>Skip</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={resetToSetup}
            style={{
              padding: 16, borderRadius: 14, backgroundColor: "#FFED29",
              alignItems: "center",
              shadowColor: "#FFED29", shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
            }}
          >
            <Text style={{ color: "black", fontSize: 17, fontWeight: "700" }}>Done</Text>
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
            }
            setBoardUploadingUid(null);
          }}
        />
      </FadeInView>
    );
  }

  // ── Render: Timer screen (playing / checking / ended) ─────────────────────
  return (
    <FadeInView>
      <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: "center" }}>

        {/* Timer */}
        <Text style={{ fontSize: 48, fontWeight: "800", textAlign: "center" }}>
          {formatDuration(displayedSec)}
        </Text>
        {phase === "checking" && (
          <Text style={{ textAlign: "center", color: "#888", fontSize: 13 }}>Timer paused</Text>
        )}

        {/* Player list */}
        {gamePlayers.length > 0 && (
          <View style={{ gap: 4 }}>
            {gamePlayers.map((p) => {
              const elim = eliminations.find((e) => e.playerUid === p.uid);
              return (
                <View
                  key={p.uid}
                  style={{
                    flexDirection: "row", justifyContent: "space-between",
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                    backgroundColor: elim ? "#f5f5f5" : "#fff",
                    borderWidth: 1, borderColor: elim ? "#eee" : "#f0f0f0",
                  }}
                >
                  <View>
                    <Text style={{
                      fontSize: 15, color: elim ? "#bbb" : "#222",
                      textDecorationLine: elim ? "line-through" : "none",
                    }}>
                      {p.displayName}
                    </Text>
                    {p.type === "guest" && p.ownerDisplayName && !elim && (
                      <Text style={{ fontSize: 11, color: "#ccc" }}>{p.ownerDisplayName}'s guest</Text>
                    )}
                  </View>
                  {elim && (
                    <Text style={{ fontSize: 12, color: "#bbb" }}>
                      Rotten @ {formatDuration(Math.floor(elim.eliminatedAt / 1000))}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* BANANAS button */}
        {phase === "playing" && (
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={handleBananas}
              onPressIn={pressIn}
              onPressOut={pressOut}
              style={{
                padding: 16, borderRadius: 14, backgroundColor: "#2bff00ff",
                alignItems: "center",
                shadowColor: "#2bff00ff", shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
              }}
            >
              <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>BANANAGRAMS</Text>
            </Pressable>
          </Animated.View>
        )}

        {saving && !pendingLastStanding && (
          <Text style={{ textAlign: "center", color: "#888" }}>Saving…</Text>
        )}
        {saveError && !pendingLastStanding && (
          <Text style={{ textAlign: "center", color: "#c00" }}>{saveError}</Text>
        )}

        {/* Last-standing board upload prompt */}
        {phase === "ended" && pendingLastStanding && !celebration && (
          <View style={{
            borderRadius: 16, borderWidth: 1, borderColor: "#eee",
            backgroundColor: "#fafafa", padding: 20, gap: 14,
          }}>
            <Text style={{ fontSize: 17, fontWeight: "700", textAlign: "center" }}>
              {pendingLastStanding.winnerName}, upload your board?
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setUploadBoardOpen(true)}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#111", alignItems: "center" }}
              >
                <Text style={{ color: "white", fontWeight: "700" }}>Scan Board</Text>
              </Pressable>
              <Pressable
                onPress={() => completePendingSave()}
                disabled={saving}
                style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" }}
              >
                <Text style={{ fontWeight: "600", color: "#555" }}>{saving ? "Saving…" : "Skip"}</Text>
              </Pressable>
            </View>
            {saveError && (
              <Text style={{ textAlign: "center", color: "#c00", fontSize: 13 }}>{saveError}</Text>
            )}
          </View>
        )}

        {!(phase === "ended" && pendingLastStanding && !celebration) && (
          <Pressable onPress={resetToSetup} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: "#bbb", fontSize: 13 }}>
              {phase === "ended" ? "New Game" : "Reset"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Checking overlay ──────────────────────────────────────────────── */}
      <Modal visible={phase === "checking"} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.72)",
          justifyContent: "center", padding: 24,
        }}>
          <View style={{
            backgroundColor: "white", borderRadius: 20, padding: 24, gap: 16,
            shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
          }}>
            {checkSubMode === "pick" && (
              <>
                <Text style={{ fontSize: 22, fontWeight: "800", textAlign: "center" }}>
                  Who called Bananas?
                </Text>
                <View style={{ gap: 10 }}>
                  {activePlayers.map((p) => (
                    <Pressable
                      key={p.uid}
                      onPress={() => handleSelectCheckingPlayer(p.uid)}
                      style={{ padding: 14, borderRadius: 12, backgroundColor: "#FFED29", alignItems: "center" }}
                    >
                      <Text style={{ fontWeight: "700", fontSize: 16 }}>{p.displayName}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={handleCancelChecking} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa", fontSize: 14 }}>Cancel (resume timer)</Text>
                </Pressable>
              </>
            )}

            {checkSubMode === "options" && checkingPlayer && (
              <>
                <Text style={{ fontSize: 20, fontWeight: "800", textAlign: "center" }}>
                  {checkingPlayer.displayName} called Bananas!
                </Text>
                <Pressable
                  onPress={() => setCheckBoardOpen(true)}
                  style={{ padding: 14, borderRadius: 12, backgroundColor: "#111", alignItems: "center" }}
                >
                  <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>Scan Board</Text>
                </Pressable>
                <Pressable
                  onPress={() => setCheckSubMode("manual")}
                  style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", alignItems: "center" }}
                >
                  <Text style={{ fontWeight: "600", fontSize: 15 }}>Manual Check</Text>
                </Pressable>
                <Pressable onPress={() => setCheckSubMode("pick")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa" }}>← Back</Text>
                </Pressable>
              </>
            )}

            {checkSubMode === "manual" && checkingPlayer && (
              <>
                <Text style={{ fontSize: 20, fontWeight: "800", textAlign: "center" }}>
                  Is {checkingPlayer.displayName}'s board valid?
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => handleCheckResult(true, null)}
                    style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: "#2bff00ff", alignItems: "center" }}
                  >
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>✓ Valid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleCheckResult(false, null)}
                    style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: "#FFEBEE", borderWidth: 1, borderColor: "#FFCDD2", alignItems: "center" }}
                  >
                    <Text style={{ fontWeight: "800", fontSize: 18, color: "#C62828" }}>✗ Rotten</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setCheckSubMode("options")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa" }}>← Back</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Board scan modal (check) ──────────────────────────────────────── */}
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

      {/* ── Board upload modal (last-standing) ───────────────────────────── */}
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

      {/* ── Celebration overlay ───────────────────────────────────────────── */}
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
    </FadeInView>
  );
}
